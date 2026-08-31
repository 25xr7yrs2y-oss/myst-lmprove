/*
 * Copyright (C) 2021 The "MysteriumNetwork/node" Authors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

package network

import "net"

// RoutingTableNoop prevents proxy-only nodes from observing or mutating host routes.
type RoutingTableNoop struct{}

func (t *RoutingTableNoop) DiscoverGateway() (net.IP, error) {
	return net.IPv4zero, nil
}

func (t *RoutingTableNoop) ExcludeRule(ip, gw net.IP) error {
	return nil
}

func (t *RoutingTableNoop) DeleteRule(ip, gw net.IP) error {
	return nil
}
