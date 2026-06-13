# myst-lmprove (Mysterium Proxy-Only Build)

[![GitHub release](https://img.shields.io/github/v/release/25xr7yrs2y-oss/myst-lmprove)](https://github.com/25xr7yrs2y-oss/myst-lmprove/releases/latest)
[![Windows Build](https://github.com/25xr7yrs2y-oss/myst-lmprove/actions/workflows/windows-build.yml/badge.svg)](https://github.com/25xr7yrs2y-oss/myst-lmprove/actions/workflows/windows-build.yml)

A customized Windows desktop client fork of [Mysterium VPN](https://github.com/mysteriumnetwork/mysterium-vpn-desktop), stripped down to run as a **local proxy-only client** — no system-wide VPN tunnel, no kernel-level firewall rules, no kill switch.

Instead of the Electron GUI, it launches a local web UI on loopback, so you control your Mysterium node through any browser on the same machine.

---

## What's Different from Upstream

| Area | Upstream | This Fork |
|------|----------|-----------|
| **Mode** | Full-tunnel VPN | Local SOCKS/HTTP proxy (`127.0.0.1:4449`) |
| **UI** | Electron `BrowserWindow` | Local web UI at `http://127.0.0.1:44051` |
| **Kill switch** | Enabled + configurable in UI | Disabled, removed from UI |
| **Windows firewall** | WFP rules installed | No firewall manipulation |
| **Supervisor** | Elevated service installed on startup | No supervisor install / upgrade |
| **Routing** | System route table modified | No route changes |

See **[CUSTOM_PROXY_BUILD.md](./CUSTOM_PROXY_BUILD.md)** for the full technical breakdown.

---

## Installation (Windows)

Download the latest `myst-lmprove Setup x.y.z.exe` from [Releases](https://github.com/25xr7yrs2y-oss/myst-lmprove/releases/latest) and run it.

The NSIS installer places the app under `%LOCALAPPDATA%\mysterium-vpn-desktop` and creates a Start Menu shortcut.

> **macOS / Linux** are not currently supported by this custom build. PRs welcome.

---

## Usage

1. Launch the app (Start Menu → MysteriumVPN, or desktop shortcut).
2. Your browser opens automatically to `http://127.0.0.1:44051/`.
3. In the web UI:
   - Start the node
   - Import or create an identity
   - Browse proposals and connect to a provider
4. Configure your application to use the local proxy at `127.0.0.1:4449` (SOCKS5 / HTTP).

### Custom Web UI Port

```pwsh
# Command-line flag
.\MysteriumVPN.exe --web-ui-port=45051

# Or environment variable
$env:MYST_WEB_UI_PORT = "45051"
.\MysteriumVPN.exe
```

### Preview Mode

Open `static/web-ui/index.html` directly in a browser (no node required) to see the UI layout and controls.
If serving through a static server, append `?preview=1`.

---

## Development

### Prerequisites

- **Go** ≥ 1.26 (for custom node binaries)
- **Node.js** ≥ 16 LTS
- **yarn** (classic v1)

### Quick Start

```sh
# 1. Clone & install JS dependencies
git clone https://github.com/25xr7yrs2y-oss/myst-lmprove.git
cd myst-lmprove
git checkout custom-proxy-build
yarn install

# 2. Build the customized Go node binaries
cd custom-node
$env:GOOS="windows"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -ldflags="-w -s" -o build/myst/myst.exe ./cmd/mysterium_node
go build -ldflags="-w -s" -o build/myst_supervisor/myst_supervisor.exe ./cmd/supervisor
cd ..

# 3. Replace packaged node binaries
mkdir -Force node_modules\@mysteriumnetwork\node\bin\win\x64
cp custom-node\build\myst\myst.exe node_modules\@mysteriumnetwork\node\bin\win\x64\
cp custom-node\build\myst_supervisor\myst_supervisor.exe node_modules\@mysteriumnetwork\node\bin\win\x64\

# 4. Dev mode (webpack dev server with hot reload)
yarn dev
```

### Packaging the Windows Installer

```sh
yarn build
yarn run electron-builder --win nsis --publish never
# Output: dist\myst-lmprove Setup x.y.z.exe
```

### CI Build

The [windows-build.yml](./.github/workflows/windows-build.yml) workflow handles the full pipeline — Go cross-compile, binary replacement, and NSIS packaging — on every push. Artifacts are available from the workflow run.

---

## Project Structure

```
├── custom-node/          # Customized Go Mysterium node + supervisor source
│   ├── cmd/
│   │   ├── mysterium_node/   # myst CLI daemon (proxy-mode patches)
│   │   └── supervisor/       # Supervisor (firewall/routing no-ops on Windows)
│   └── ...
├── src/
│   ├── main/
│   │   ├── index.tsx         # App entry: skips BrowserWindow, launches web server
│   │   ├── webServer.ts      # Express-backed local web UI + TequilAPI proxy
│   │   └── webTray.ts        # System tray integration
│   └── app/                  # Renderer-side store patches (disable kill switch)
├── static/
│   ├── web-ui/index.html     # Self-contained local web UI
│   └── logo.ico              # App icon
├── .github/workflows/
│   └── windows-build.yml     # CI pipeline
├── CUSTOM_PROXY_BUILD.md     # Detailed technical documentation
└── package.json
```

---

## License

This project follows the same license as the upstream [Mysterium VPN](https://github.com/mysteriumnetwork/mysterium-vpn-desktop). See [LICENSE](./LICENSE).
