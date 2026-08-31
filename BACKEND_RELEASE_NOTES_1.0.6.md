# Privacy Browser backend v1.0.6

This backend build fixes proxy-mode route isolation for Privacy Browser:

- WireGuard P2P setup skips host route exclusion when `--proxymode` is active.
- Proxy mode selects a no-op routing implementation, preventing supervisor pipe
  access and system-route mutation even if a future caller requests an exclusion.
- Initial gateway discovery for real system-tunnel modes is cancelable, uses
  exponential backoff, stops after five attempts, and returns a specific error.
- Route initialization errors are propagated to callers instead of being logged
  and discarded.
- The Windows workflow injects and verifies the exact source commit, ref, build
  identifier, and release version reported by `myst.exe --version`.

The release assets contain the Windows x64 backend binary, its version output,
and a JSON provenance record with the binary SHA-256. No live provider, device,
browser, or network validation was performed for this backend release.
