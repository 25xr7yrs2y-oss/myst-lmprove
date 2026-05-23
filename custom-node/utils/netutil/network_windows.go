//go:build windows

/*
 * Copyright (C) 2020 The "MysteriumNetwork/node" Authors.
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

package netutil

import (
	"net"
	"os/exec"
	"strconv"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

func assignIP(iface string, subnet net.IPNet) error {
	out, err := exec.Command("powershell", "-Command", "netsh interface ip set address name=\""+iface+"\" source=static "+subnet.String()).CombinedOutput()
	return errors.Wrap(err, string(out))
}

func excludeRoute(ip, gw net.IP) error {
	return nil
}

func deleteRoute(ip, gw string) error {
	return nil
}

func addDefaultRoute(name string) error {
	return nil
}

func interfaceInfo(name string) (id, gw string, err error) {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return "", "", errors.Wrap(err, "failed to get interfaces "+name)
	}

	addrs, err := iface.Addrs()
	if err != nil {
		return "", "", errors.Wrap(err, "failed to get interfaces addresses")
	}

	var ipv4 net.IP
	for _, addr := range addrs {
		ip, _, err := net.ParseCIDR(addr.String())
		if err != nil {
			log.Error().Err(err).Msg("Failed to parse an interface IP address")
		}

		if ip.To4() == nil {
			continue
		}

		if ipv4.Equal(net.IPv4zero) {
			return "", "", errors.New("failed to get interface info: exactly 1 IPv4 expected")
		}

		ipv4 = ip.To4()
		ipv4[net.IPv4len-1] = byte(1)
	}

	return strconv.Itoa(iface.Index), ipv4.String(), nil
}

func logNetworkStats() {
	for _, args := range []string{"ipconfig /all", "netstat -r"} {
		out, err := exec.Command("powershell", "-Command", args).CombinedOutput()
		logOutputToTrace(out, err, args)
	}
}
