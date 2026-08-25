# Diagnostic threshold profile

JoyConBench uses the versioned `research-1` profile to turn complete captures into `pass` or
`potential-issue` results. These are practical, research-based reference ranges—not Nintendo service
limits and not proof of a hardware fault. A test remains `inconclusive` when it does not capture
enough usable input.

## Reference values

| Test                 | Potential-issue reference                                                | Basis                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stick neutral        | Centre offset above `0.08`, or RMS jitter above `0.025`                  | Nintendo's documented stick parameters use a radial dead zone that reverse-engineering notes estimate at about 15% of physical travel for Joy-Con and 10% for Pro Controller. JoyConBench uses a lower observed-motion boundary so it can reveal drift before the console dead zone masks it. |
| Circular range       | Less than 90% angular coverage, or minimum nominal reach below `0.45`    | Factory calibration examples show per-axis half-ranges around 1060–1296 raw counts. JoyConBench deliberately normalizes against the nominal 12-bit centre rather than reading device calibration, so a healthy physical edge is expected around 0.52–0.63 rather than 1.0.                    |
| Release and snapback | Opposite-direction excursion above `0.10` after crossing the centre      | The release detector arms after `0.40` nominal travel and treats `0.12` as a centre return. The limit is slightly above the nominal equivalent of Nintendo's default radial dead zone.                                                                                                        |
| Gyroscope at rest    | Combined bias above `10°/s`, or combined axis noise above `2.5°/s`       | Joy-Con enables the LSM6DS3-family IMU at ±2000°/s. ST documents zero-rate offset as a material source of error; the limit is conservative because JoyConBench does not read per-device gyro calibration.                                                                                     |
| Gyroscope axes       | Any axis range below `50°/s` during the guided rotation                  | This is a functional response check, well below the configured ±2000°/s full scale and easy to exceed with a deliberate hand rotation.                                                                                                                                                        |
| Connection           | Rate below `52 Hz`, p95 interval above `30 ms`, or counter loss above 3% | Standard full reports arrive at roughly 60 frames/s, with reverse-engineering notes describing an update interval around 15 ms. The profile allows scheduling and Bluetooth variation while flagging sustained instability.                                                                   |

## Sources

- [Nintendo Switch Reverse Engineering: SPI flash and calibration notes](https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/blob/master/spi_flash_notes.md)
- [Nintendo Switch Reverse Engineering: IMU subcommands and sensitivity](https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/blob/master/bluetooth_hid_subcommands_notes.md)
- [Nintendo Switch Reverse Engineering: controller and IMU report timing](https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/blob/master/README.md)
- [Joy-Con WebHID](https://github.com/tomayac/joy-con-webhid), whose implementation and report-rate observations are an interoperability reference
- [STMicroelectronics LSM6DS3 product documentation](https://www.st.com/en/mems-and-sensors/lsm6ds3tr-c.html)

Thresholds should be revised as anonymized hardware fixtures cover more original left/right Joy-Con
and Pro Controllers over Bluetooth and USB. Every report records the threshold profile version and
classification basis so future comparisons remain interpretable.
