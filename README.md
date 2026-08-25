# JoyConBench

**Open controller diagnostics for Nintendo Switch.**

JoyConBench is a local-first browser application for testing official original-generation left
Joy-Con, right Joy-Con, and Nintendo Switch Pro Controllers through WebHID. Controller samples stay
in the browser and are never uploaded. Connect once, use the live button playground, and choose
individual tests in any order. Stick drift is the fast default recommendation; no guided tour is
required.

## Test bench

- Live controller rendering, three-axis gyroscope rates, and a button checklist immediately after connection
- Independently selectable drift, circular-range, snapback, IMU, motion, packet, LED, and rumble
  checks
- In-memory results with printable, privacy-safe JSON and plain-text reports
- One-click **Start again** at the end of a report for testing the next Joy-Con
- Body and button colour editing with standard retail presets plus fast, scoped settings backup and restore

## Browser and hardware support

- Desktop Chrome, Edge, and compatible Chromium browsers
- HTTPS or localhost
- Joy-Con over Bluetooth
- Pro Controller over Bluetooth or USB

Safari, Firefox, iOS, third-party controllers, and Switch 2 controllers are not supported in v1.

## Development

Use Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

Quality checks:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Add `?debug=1` to the local URL to show the protocol lab.

## Cloudflare Pages

Connect this GitHub repository to a Cloudflare Pages project with:

- Production branch: `main`
- Build command: `pnpm build`
- Build output directory: `dist`
- Root directory: repository root
- Node version: 24

Cloudflare Web Analytics must remain disabled. GitHub Actions performs CI; Cloudflare Pages handles
production and same-repository pull-request previews.

## Safety and privacy

Diagnostics use transient commands for full input reports, IMU, LEDs, and bounded rumble. The
optional controller tools can read and write only documented colour, factory-calibration, and
sensor/stick-parameter regions after explicit confirmation. Compact `.bin` backups contain 97 bytes
rather than the old toolkit's raw 512 KB flash dump, exclude serial/pairing/firmware/patch/unknown
regions, include a SHA-256 checksum and controller product type, and are verified after restore.
Legacy JoyConBench JSON backups remain importable. SPI erase and all firmware commands remain
blocked.

Reports never include backup contents or calibration values. They also omit MAC addresses, serial
numbers, raw HID packets, and sample streams. See [PRIVACY.md](./PRIVACY.md) for the complete data
boundary.

## Nintendo disclaimer

JoyConBench is an independent open-source project. It is not affiliated with, endorsed by, or
sponsored by Nintendo. Nintendo Switch, Joy-Con, and related names are trademarks of Nintendo.

The interactive Joy-Con geometry is adapted from a CC BY-SA 4.0 Wikimedia Commons illustration;
see [NOTICE.md](./NOTICE.md) for attribution and modification details.

## License

[MIT](./LICENSE)
