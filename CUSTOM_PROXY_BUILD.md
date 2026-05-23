# MysteriumDark Proxy-Only Build

This fork customizes the Windows desktop client to behave like a local proxy client instead of a full-tunnel VPN.

## Behavior changes

- The desktop app starts `myst` with `--proxymode`.
- Connection requests set `disableKillSwitch: true` to disable session traffic blocking and use local proxy port `4449`.
- Startup no longer installs or upgrades the elevated supervisor service.
- The kill switch settings row is removed from the desktop UI and the config setter is a no-op.
- Windows WFP firewall setup is bypassed in `custom-node/supervisor/daemon/wireguard/wginterface`.
- Windows route add/delete/default-route helpers are no-ops in `custom-node/router/network` and `custom-node/utils/netutil`.

The Windows installer workflow builds the customized Go node and supervisor binaries, replaces the binaries downloaded by `@mysteriumnetwork/node`, and packages the Electron app as an NSIS installer artifact.
