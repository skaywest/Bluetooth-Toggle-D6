# Bluetooth Toggle for FIFINE D6

Native Windows Bluetooth toggle for FIFINE D6.

- No PowerShell or scripts.
- No Windows service, scheduled task, startup entry, or polling loop.
- A short-lived native helper reads the actual Windows radio state at appearance and toggles only on key press.
- The button state is never restored from a stale saved value.

GitHub Actions builds and packages the plugin. Adapter/driver access still needs real-device testing.