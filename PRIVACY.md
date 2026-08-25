# JoyConBench privacy boundary

JoyConBench has no account, analytics, telemetry, remote fonts, advertising, or application backend.
Live WebHID reports and diagnostic samples are processed locally and kept in bounded browser memory
for the current session. Choosing **Start again**, disconnecting, or closing the page clears that
session data.

## Diagnostic reports

Exported reports contain aggregate measurements, interpretations, controller type, connection kind,
a reduced browser/platform description, the application version, and a timestamp. Vendor and product
IDs are optional. Reports exclude MAC addresses, serial numbers, raw HID packets, input sample
streams, and controller calibration values.

## Controller settings backups

Settings backups are created only when requested and downloaded directly by the browser. The compact
binary container holds 97 bytes from documented controller regions for the colour-use flag, factory
motion calibration, left/right stick calibration, appearance, and sensor/stick parameters. They
exclude serial, pairing, firmware, patch, and unidentified flash regions. A backup stays on the
user's device and is never added to a diagnostic report or uploaded by JoyConBench.

Restoring or changing colours is a persistent controller operation. JoyConBench requires explicit
confirmation, restricts the target addresses, rejects mismatched controller types or checksums, and
reads every restored value back for verification. SPI erase and firmware commands are not allowed.

## Network behavior

After the application is loaded, diagnostics and controller tools do not require a network request.
The production service worker may cache application files for offline relaunch. Cloudflare Web
Analytics should remain disabled.
