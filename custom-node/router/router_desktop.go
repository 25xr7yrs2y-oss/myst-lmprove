//go:build !android

/*
 * Copyright (C) 2021 The "MysteriumNetwork/node" Authors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

package router

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/mysteriumnetwork/node/config"
	"github.com/mysteriumnetwork/node/router/network"
)

type manager struct {
	mu sync.Mutex

	startMu sync.Mutex
	started bool

	rules     []rule
	currentGW net.IP

	routingTable    router
	routingDisabled bool

	gwCheckInterval        time.Duration
	gwDiscoveryAttempts    int
	gwDiscoveryBackoffBase time.Duration

	onceStop sync.Once
	stop     chan struct{}
}

type router interface {
	DiscoverGateway() (net.IP, error)
	ExcludeRule(ip, gw net.IP) error
	DeleteRule(ip, gw net.IP) error
}

type rule struct {
	ip    net.IP
	usage int
}

var (
	// ErrGatewayDiscoveryFailed identifies an exhausted, bounded initial gateway lookup.
	ErrGatewayDiscoveryFailed = errors.New("system default gateway discovery failed")
	// ErrRouterStopped identifies route initialization canceled by manager shutdown.
	ErrRouterStopped = errors.New("routing manager stopped")
)

const (
	defaultGWDiscoveryAttempts    = 5
	defaultGWDiscoveryBackoffBase = 100 * time.Millisecond
)

// NewManager creates a new instance of service that maintain routing table to match current state.
func NewManager() *manager {
	var r router = &network.RoutingTable{}
	routingDisabled := false

	if config.GetBool(config.FlagProxyMode) {
		// Proxy mode uses a userspace netstack and must never depend on or mutate
		// the host routing table, even if a future caller requests an exclusion.
		r = &network.RoutingTableNoop{}
		routingDisabled = true
	} else if config.GetBool(config.FlagUserMode) || config.GetBool(config.FlagUserspace) {
		r = &network.RoutingTableRemote{}
	}

	return &manager{
		stop: make(chan struct{}),

		gwCheckInterval:        5 * time.Second,
		gwDiscoveryAttempts:    defaultGWDiscoveryAttempts,
		gwDiscoveryBackoffBase: defaultGWDiscoveryBackoffBase,
		routingTable:           r,
		routingDisabled:        routingDisabled,
	}
}

func (m *manager) ExcludeIP(ip net.IP) error {
	return m.ExcludeIPContext(context.Background(), ip)
}

func (m *manager) ExcludeIPContext(ctx context.Context, ip net.IP) error {
	if m.routingDisabled {
		return nil
	}
	if err := m.ensureStarted(ctx); err != nil {
		return fmt.Errorf("failed to initialize route manager: %w", err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	new := true

	for i, rule := range m.rules {
		if !rule.ip.Equal(ip) {
			continue
		}

		new = false
		m.rules[i].usage++

		break
	}

	if !new {
		return nil
	}

	if err := m.routingTable.ExcludeRule(ip, m.currentGW); err != nil {
		return fmt.Errorf("failed to exclude rule: %w", err)
	}

	m.rules = append(m.rules, rule{
		ip:    ip,
		usage: 1,
	})

	return nil
}

func (m *manager) RemoveExcludedIP(ip net.IP) error {
	if m.routingDisabled {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, rule := range m.rules {
		if !rule.ip.Equal(ip) {
			continue
		}

		m.rules[i].usage--

		if m.rules[i].usage == 0 {
			m.rules = append(m.rules[:i], m.rules[i+1:]...)

			if err := m.routingTable.DeleteRule(ip, m.currentGW); err != nil {
				return fmt.Errorf("failed to remove excluded rule: %w", err)
			}
		}

		break
	}

	return nil
}

func (m *manager) ensureStarted(ctx context.Context) error {
	m.startMu.Lock()
	defer m.startMu.Unlock()

	if m.started {
		return nil
	}
	select {
	case <-m.stop:
		return ErrRouterStopped
	default:
	}
	if err := m.forceCheckGW(ctx); err != nil {
		return err
	}
	m.started = true
	go m.start()
	return nil
}

func (m *manager) start() {
	for {
		select {
		case <-time.After(m.gwCheckInterval):
			if err := m.checkGW(); err != nil {
				log.Error().Err(err).Msg("Failed to detect system default gateway, keeping old value")
			}
		case <-m.stop:
			return
		}
	}
}

func (m *manager) Stop() {
	if err := m.Clean(); err != nil {
		log.Error().Err(err).Msg("Failed to clean routing rules")
	}

	m.onceStop.Do(func() {
		close(m.stop)
	})
}

func (m *manager) Clean() (lastErr error) {
	if m.routingDisabled {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.clean(); err != nil {
		return fmt.Errorf("failed to clean routes: %w", err)
	}

	m.rules = nil

	return nil
}

func (m *manager) clean() (lastErr error) {
	for _, rule := range m.rules {
		err := m.routingTable.DeleteRule(rule.ip, m.currentGW)
		if err != nil {
			lastErr = err
			log.Error().Err(err).Msgf("Failed to delete route: %+v", rule)
		}
	}

	return lastErr
}

func (m *manager) apply(gw net.IP) (lastErr error) {
	for _, rule := range m.rules {
		err := m.routingTable.ExcludeRule(rule.ip, gw)
		if err != nil {
			lastErr = err
			log.Error().Err(err).Msgf("Failed to delete route: %+v", rule)
		}
	}

	m.currentGW = gw

	return lastErr
}

func (m *manager) forceCheckGW(ctx context.Context) error {
	attempts := m.gwDiscoveryAttempts
	if attempts <= 0 {
		attempts = defaultGWDiscoveryAttempts
	}
	backoff := m.gwDiscoveryBackoffBase
	if backoff <= 0 {
		backoff = defaultGWDiscoveryBackoffBase
	}

	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("%w: %w", ErrGatewayDiscoveryFailed, err)
		}
		if err := m.checkGW(); err == nil {
			return nil
		} else {
			lastErr = err
		}

		if attempt == attempts {
			break
		}
		timer := time.NewTimer(backoff << (attempt - 1))
		select {
		case <-ctx.Done():
			timer.Stop()
			return fmt.Errorf("%w: %w", ErrGatewayDiscoveryFailed, ctx.Err())
		case <-m.stop:
			timer.Stop()
			return ErrRouterStopped
		case <-timer.C:
		}
	}
	return fmt.Errorf("%w after %d attempts: %w", ErrGatewayDiscoveryFailed, attempts, lastErr)
}

func (m *manager) checkGW() error {
	gw, err := m.routingTable.DiscoverGateway()
	if err != nil {
		return fmt.Errorf("discover system default gateway: %w", err)
	}
	if gw == nil || gw.IsUnspecified() {
		return errors.New("discover system default gateway: no usable gateway returned")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.currentGW.Equal(gw) {

		log.Info().Msgf("Default gateway changed to %s, reconfiguring routes.", gw)

		if err := m.clean(); err != nil {
			log.Error().Err(err).Msg("Failed to clean routing rules")
		}

		if err := m.apply(gw); err != nil {
			log.Error().Err(err).Msg("Failed to apply new routing rules")
		}
	}
	return nil
}
