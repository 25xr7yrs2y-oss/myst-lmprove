/*
 * Copyright (C) 2025 The "MysteriumNetwork/node" Authors.
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

package server

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/rs/zerolog/log"

	"github.com/mysteriumnetwork/node/config"
	qc "github.com/mysteriumnetwork/node/services/quic/quic"
	"github.com/mysteriumnetwork/node/services/quic/streams"
)

// QuicServer represents QUIC server.
type QuicServer struct {
	tlsc *tls.Config

	listener *quic.Listener

	mu                sync.RWMutex
	communicationConn qc.Connection
	transportConn     qc.Connection
}

// NewQuicServer creates new QUIC server.
func NewQuicServer() (*QuicServer, error) {
	key := config.GetString(config.FlagQUICKey)
	cert := config.GetString(config.FlagQUICCert)

	tlsCert, err := tls.LoadX509KeyPair(cert, key)
	if err != nil {
		return nil, fmt.Errorf("failed to load certificates: %w", err)
	}

	tlsc := &tls.Config{
		Certificates: []tls.Certificate{tlsCert},
		NextProtos:   []string{"myst-communication", "myst-transport"},
		MinVersion:   tls.VersionTLS13,
	}

	return &QuicServer{
		tlsc: tlsc,
	}, nil
}

// Start starts QUIC server.
func (s *QuicServer) Start(ctx context.Context) error {
	err := s.listenAndServeQUIC(ctx, s.tlsc)
	if err != nil {
		return fmt.Errorf("failed to listen and serve QUIC: %w", err)
	}

	return nil
}

// Close closes QUIC server.
func (s *QuicServer) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var errs []error

	if s.listener != nil {
		if err := s.listener.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close listener: %w", err))
		}
		s.listener = nil
	}

	if s.communicationConn != nil {
		if err := s.communicationConn.CloseWithError(0, "server closed"); err != nil {
			errs = append(errs, fmt.Errorf("failed to close communication connection: %w", err))
		}
		s.communicationConn = nil
	}

	if s.transportConn != nil {
		if err := s.transportConn.CloseWithError(0, "server closed"); err != nil {
			errs = append(errs, fmt.Errorf("failed to close transport connection: %w", err))
		}
		s.transportConn = nil
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors during QUIC server close: %v", errs)
	}

	return nil
}

// CommunicationConn returns communication connection.
func (s *QuicServer) CommunicationConn(ctx context.Context) (*streams.QuicConnection, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("context done: %w", ctx.Err())
		default:
			if s.communicationConn != nil {
				return &streams.QuicConnection{
					Connection: s.communicationConn,
				}, nil
			}

			log.Debug().Msg("Waiting for communication connection")
			time.Sleep(200 * time.Millisecond)
		}
	}
}

// TransportConn returns transport connection.
func (s *QuicServer) TransportConn(ctx context.Context) (*streams.QuicConnection, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("context done: %w", ctx.Err())
		default:
			if s.transportConn != nil {
				return &streams.QuicConnection{
					Connection: s.transportConn,
				}, nil
			}

			log.Debug().Msg("Waiting for transport connection")
			time.Sleep(200 * time.Millisecond)
		}
	}
}

func (s *QuicServer) listenAndServeQUIC(ctx context.Context, tlsc *tls.Config) (err error) {
	s.listener, err = quic.ListenAddr("", tlsc, &quic.Config{
		KeepAlivePeriod:       time.Second * 5,
		MaxIdleTimeout:        time.Second * 10,
		MaxIncomingStreams:    10000,
		MaxIncomingUniStreams: 10000,
	})
	if err != nil {
		return fmt.Errorf("failed to listen for quic connection %w", err)
	}

	// Ensure listener is closed when context is cancelled
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.listener != nil {
			s.listener.Close()
			s.listener = nil
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			c, err := s.listener.Accept(ctx)
			if err != nil {
				s.mu.RLock()
				listenerClosed := s.listener == nil
				s.mu.RUnlock()
				if listenerClosed {
					log.Debug().Msg("QUIC listener closed, exiting accept loop")
					return nil
				}
				log.Error().Err(err).Msg("failed to accept QUIC connection")
				continue
			}

			s.mu.Lock()
			switch c.ConnectionState().TLS.NegotiatedProtocol {
			case "myst-communication":
				log.Info().Msg("Setting communication connection")
				if s.communicationConn != nil {
					log.Warn().Msg("Closing old communication connection before replacing")
					s.communicationConn.CloseWithError(0, "replaced by new connection")
				}
				s.communicationConn = c
			case "myst-transport":
				log.Info().Msg("Setting transport connection")
				if s.transportConn != nil {
					log.Warn().Msg("Closing old transport connection before replacing")
					s.transportConn.CloseWithError(0, "replaced by new connection")
				}
				s.transportConn = c
			}
			s.mu.Unlock()
		}
	}
}

// WaitForListenPort waits for listen port.
func (s *QuicServer) WaitForListenPort(ctx context.Context) (string, error) {
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
			if s.listener != nil {
				_, port, err := net.SplitHostPort(s.listener.Addr().String())
				if err != nil {
					return "", fmt.Errorf("failed to split host port: %w", err)
				}

				return port, nil
			}

			log.Info().Msg("Waiting for listen address")
			time.Sleep(200 * time.Millisecond)
		}
	}
}
