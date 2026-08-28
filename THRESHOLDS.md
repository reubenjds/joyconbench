# Diagnostic threshold profile

JoyConBench uses the versioned `research-2` profile. The limits are conservative,
research-based references rather than Nintendo service limits or proof of a hardware fault.

A valid concerning capture is labelled `check-again`. It becomes `potential-issue` only when the
same test produces another valid concerning capture in the current controller session. A pass clears
the pending concern. An incomplete or disturbed capture remains `inconclusive` and does not change
confirmation history.

## Reference values and quality gates

| Test                 | Usable capture                                                                     | Check-again reference                                                             |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stick neutral        | Five seconds, at least 200 samples, no brief manual excursion                      | Median centre offset above `0.15`, or trimmed RMS jitter above `0.05`             |
| Circular range       | At least 14 of 16 sectors and two full rotations                                   | Lower-sector calibrated reach below `0.75`, or directional imbalance above `0.35` |
| Release and snapback | Four releases covering up, down, left, and right                                   | At least two opposite-direction excursions above `0.15`                           |
| Gyroscope at rest    | Five seconds, at least 600 IMU frames, accelerometer p95 deviation at most `0.08g` | Calibrated combined bias above `10°/s`, or combined trimmed noise above `2.5°/s`  |
| Gyroscope axes       | Separate four-second guided X, Y, and Z captures                                   | Any instructed axis range below `50°/s`                                           |
| Connection           | Ten seconds while the page remains visible                                         | Browser arrival rate below `45 Hz`, or p95 interval above `40 ms`                 |

Stick values use the active user calibration when present, then factory calibration, then nominal
12-bit normalization. IMU values use the active user or factory offsets and scales, falling back to
documented nominal values only when calibration cannot be read or validated. Reports include only
the calibration source (`user`, `factory`, or `nominal`), never the calibration values.

The first byte of a standard full input report is a fast-running controller timer. It is recorded as
informational context but is not treated as a one-step packet counter and is not used to infer dropped
reports. Connection classification uses monotonic WebHID arrival timestamps instead.

## IR camera cover check

The IR camera tool is separate from diagnostic reports and does not create a saved result. It uses a
fixed 80×60 grayscale image-transfer mode on an original right Joy-Con. Each measurement stage needs
at least five complete frames. The on-screen check passes when the median brightness while covered
is at least `12` grayscale levels higher than the uncovered median on the `0–255` scale.

This relative response confirms that complete images arrive and the sensor reacts to reflected IR
light. It does not measure focus, absolute sensitivity, depth, or compliance with a Nintendo service
specification. Ambient infrared light, distance, and an incompletely covered camera window can make
the check inconclusive.

## Sources

- [Nintendo Switch Reverse Engineering: Bluetooth HID report format](https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/blob/master/bluetooth_hid_notes.md)
- [Nintendo Switch Reverse Engineering: SPI flash and calibration](https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/blob/master/spi_flash_notes.md)
- [Nintendo Switch Reverse Engineering: IMU conversion and calibration](https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/blob/master/imu_sensor_notes.md)
- [Linux Nintendo HID driver](https://codebrowser.dev/linux/linux/drivers/hid/hid-nintendo.c.html)
- [Joy-Con WebHID](https://github.com/tomayac/joy-con-webhid)

The profile remains `research-based` until anonymized fixtures cover a representative set of healthy
and faulty original left and right Joy-Con over Bluetooth.
