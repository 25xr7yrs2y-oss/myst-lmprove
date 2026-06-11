# MysteriumDark Proxy-Only Build

This fork customizes the Windows desktop client to behave like a local proxy client instead of a full-tunnel VPN.

## Behavior changes

- The desktop app starts `myst` with `--proxymode`.
- Connection requests set `disableKillSwitch: true` to disable session traffic blocking and use local proxy port `4449`.
- Startup no longer installs or upgrades the elevated supervisor service.
- The kill switch settings row is removed from the desktop UI and the config setter is a no-op.
- Windows WFP firewall setup is bypassed in `custom-node/supervisor/daemon/wireguard/wginterface`.
- Windows route add/delete/default-route helpers are no-ops in `custom-node/router/network` and `custom-node/utils/netutil`.
- The Electron renderer window is bypassed. The packaged app now acts as a localhost launcher:
  - It starts a web UI on `127.0.0.1:44051` by default.
  - It opens the system browser to the local web UI instead of creating an Electron `BrowserWindow`.
  - It starts `myst` on Tequilapi port `44050` and keeps proxy traffic on `127.0.0.1:4449`.
  - The web UI includes node start/stop, connection, provider proposal, identity import/export, settings, and logs views.
- The Windows package now uses `static/logo.ico` for Windows app and NSIS shortcut icons.

The Windows installer workflow builds the customized Go node and supervisor binaries, replaces the binaries downloaded by `@mysteriumnetwork/node`, and packages the Electron app as an NSIS installer artifact.

## Local web UI

Launch the installed app normally. It binds the web interface to loopback and opens:

```text
http://127.0.0.1:44051/
```

To use a different local port, launch the app with:

```text
--web-ui-port=45051
```

or set:

```text
MYST_WEB_UI_PORT=45051
```

The static preview copy of the page is:

```text
static/web-ui/index.html
```

Opening that file directly shows preview data and all planned controls without requiring the Myst node to run.
If you serve the file through a static server, append `?preview=1` to force preview data.
