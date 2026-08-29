# Right Joy-Con IR camera

## What it is

The **IR** tab streams the near-infrared camera built into an original right Joy-Con
(`057e:2007`) and draws it as an 80 × 60 grayscale image. It is a near-infrared sensor, not a
thermal one: it sees reflected or emitted IR light, including most remote controls.

Code:

- `src/protocol/ir.ts` — packet builders, fragment parsing, frame assembly.
- `src/adapters/NintendoIrCamera.ts` — the start-up handshake, acknowledgement loop, diagnostics.
- `src/components/IrCameraTool.tsx` — canvas, statistics, cover check, start-up log export.

## How it works

The camera lives behind the Joy-Con's NFC/IR microcontroller (MCU), which has to be powered and
configured before it sends anything. `NintendoIrCamera.start()` runs this sequence, mirroring
CTCaer's `jc_toolkit` (`jctool/jctool.cpp`, `ir_sensor()`), which is the reference trace for the
community-documented protocol:

| Step                         | Packet                                                           | Confirmation                                             |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| 1. Input report mode `0x31`  | subcommand `0x03` arg `0x31`                                     | subcommand acknowledgement                               |
| 2. Resume MCU                | subcommand `0x22` arg `0x01`                                     | subcommand acknowledgement                               |
| 3. Wait for standby          | output `0x11` command `0x01`                                     | `0x31` report, MCU report `0x01`, mode `0x01` (advisory) |
| 4. MCU into IR mode          | subcommand `0x21`, MCU data `21 00 05`                           | `0x21` reply whose MCU data is a state report `0x01`     |
| 5. Wait for IR mode          | output `0x11` command `0x01`                                     | `0x31` report, mode `0x05` (advisory)                    |
| 6. Image transfer            | subcommand `0x21`, MCU data `23 01 07 0f 00 05 00 18`            | `0x21` reply starting with `0x0b`                        |
| 7. Sensor registers, group 1 | subcommand `0x21`, MCU data `23 04 09 …` + output `0x11` `03 02` | `0x21` reply `13 00 07`                                  |
| 8. Sensor registers, group 2 | subcommand `0x21`, MCU data `23 04 08 …`                         | `0x21` reply `13 00 07` or `23`                          |
| 9. Start streaming           | output `0x11` command `0x03`, acknowledging fragment `0`         | fragments begin arriving                                 |

Byte offsets assume WebHID's `event.data`, which **excludes** the report ID, so every offset is one
lower than the numbers quoted in the reverse-engineering notes: MCU report type at 48, MCU mode at
55, fragment number at 51, 300 pixel bytes at 58.

### Streaming

The MCU sends one 300-byte fragment at a time and will not advance until the previous fragment is
acknowledged. Every `0x31` report must produce exactly one outgoing `0x11` packet:

- MCU report `0x03` (image data) → acknowledge **the fragment number that just arrived**
  (`buildIrFragmentPoll(n)`); sixteen fragments make one 80 × 60 frame.
- A gap in the sequence → ask the MCU to resume from the fragment we are still waiting for
  (`buildIrFragmentPoll(next, true)`), once. Asking repeatedly stalls the stream.
- MCU report `0xff` (empty) → re-acknowledge the last fragment. Leaving these unanswered drops the
  MCU into a slow polling mode and the stream appears to hang.
- MCU report `0x00` (no data yet) → request the next fragment.

`stop()` suspends the MCU (`0x22` arg `0x00`) and restores input report `0x30`.

## How to change it

- **Resolution.** Register `0x2e00` in `STEP_ONE_REGISTERS` selects the sensor binning (`0x64` is
  80 × 60). Changing it also changes the fragment count in `buildIrModeConfig()` — the blob is
  `fragments × 300` bytes — and `IR_WIDTH`/`IR_HEIGHT`.
- **Exposure, LEDs, denoise.** Registers `0x3001`/`0x3101` (exposure), `0x1000`/`0x1100`/`0x1200`
  (LED groups and intensity), `0x6701`–`0x6901` (denoise). Register `0x0700` must stay last in
  group two: it commits every other register write.
- **Handshake pacing.** `DEFAULT_TIMINGS` in `NintendoIrCamera.ts` controls attempts and timeouts;
  tests inject faster values through the constructor's third argument.
- **Gotcha: the mode polls are advisory.** Some firmware never reports an intermediate MCU mode, so
  steps 3 and 5 log and continue instead of failing. The authoritative gates are the `0x21` replies
  in steps 4, 6, 7 and 8. Making the polls fatal is what previously made the camera unusable on real
  hardware.
- **Gotcha: acknowledge, do not predict.** Acknowledging the _next_ fragment instead of the received
  one leaves the MCU waiting forever.

When something regresses, run the camera on hardware, press **Copy start-up log** on the error state,
and compare the trace with the table above. Every stage, attempt number and last reply is recorded.

## Configuration

No environment variables. Everything is compile-time: the register tables and payload builders in
`src/protocol/ir.ts` and `DEFAULT_TIMINGS` in `src/adapters/NintendoIrCamera.ts`. The feature is
offered only when the connected controller reports kind `joycon-right`.

## Dependencies

- WebHID (`src/hid/WebHIDTransport.ts`) for subcommand `0x01`, MCU `0x11` and rumble output reports.
  `buildSubcommandPacket`/`buildMcuPacket` in `src/protocol/nintendo.ts` allow-list the packets the
  app may send.
- No external services. The camera image never leaves the browser.
- Protocol references: CTCaer's `jc_toolkit` and dekuNukem's `Nintendo_Switch_Reverse_Engineering`.
  The protocol is community reverse-engineered; a physical packet trace outranks both.
