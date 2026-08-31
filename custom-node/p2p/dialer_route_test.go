/*
 * Copyright (C) 2020 The "MysteriumNetwork/node" Authors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

package p2p

import (
	"context"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mysteriumnetwork/node/config"
)

func TestDialerProxyModeDoesNotExcludePeerFromSystemRoutes(t *testing.T) {
	originalConfig := config.Current
	config.Current = config.NewConfig()
	t.Cleanup(func() { config.Current = originalConfig })
	config.Current.SetCLI(config.FlagProxyMode.Name, true)

	calls := 0
	d := &dialer{excludeIP: func(context.Context, net.IP) error {
		calls++
		return nil
	}}

	assert.NoError(t, d.excludePeerFromRoutes(context.Background(), "wireguard", net.ParseIP("203.0.113.10")))
	assert.Zero(t, calls)
}

func TestDialerSystemTunnelStillExcludesPeerFromRoutes(t *testing.T) {
	originalConfig := config.Current
	config.Current = config.NewConfig()
	t.Cleanup(func() { config.Current = originalConfig })

	calls := 0
	d := &dialer{excludeIP: func(context.Context, net.IP) error {
		calls++
		return nil
	}}

	assert.NoError(t, d.excludePeerFromRoutes(context.Background(), "wireguard", net.ParseIP("203.0.113.10")))
	assert.Equal(t, 1, calls)
}
