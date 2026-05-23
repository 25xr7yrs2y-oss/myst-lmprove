/*
 * Copyright (C) 2026 The "MysteriumNetwork/node" Authors.
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

package quic

import (
	"context"
	"net"

	"github.com/quic-go/quic-go"
)

// Connection is a local abstraction over quic-go's Connection interface.
type Connection interface {
	// AcceptStream returns the next stream opened by the peer, blocking until one is available.
	// If the connection was closed due to a timeout, the error satisfies
	// the net.Error interface, and Timeout() will be true.
	AcceptStream(context.Context) (*quic.Stream, error)
	// OpenStream opens a new bidirectional QUIC stream.
	// There is no signaling to the peer about new streams:
	// The peer can only accept the stream after data has been sent on the stream,
	// or the stream has been reset or closed.
	// When reaching the peer's stream limit, it is not possible to open a new stream until the
	// peer raises the stream limit. In that case, a StreamLimitReachedError is returned.
	OpenStream() (*quic.Stream, error)
	// LocalAddr returns the local address.
	LocalAddr() net.Addr
	// RemoteAddr returns the address of the peer.
	RemoteAddr() net.Addr
	// CloseWithError closes the connection with an error.
	// The error string will be sent to the peer.
	CloseWithError(quic.ApplicationErrorCode, string) error
	// Context returns a context that is cancelled when the connection is closed.
	// The cancellation cause is set to the error that caused the connection to
	// close, or `context.Canceled` in case the listener is closed first.
	Context() context.Context
	// ConnectionState returns basic details about the QUIC connection.
	ConnectionState() quic.ConnectionState
}
