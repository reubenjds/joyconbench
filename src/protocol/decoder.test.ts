import { describe, expect, it } from 'vitest';
import { decodeStandardFullReport, normalizeStick } from './decoder';
import { buildSubcommandPacket } from './nintendo';

function setStick(bytes: Uint8Array, offset: number, x: number, y: number) {
  bytes[offset] = x & 0xff;
  bytes[offset + 1] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4);
  bytes[offset + 2] = (y >> 4) & 0xff;
}

describe('Nintendo report decoder', () => {
  it('decodes right Joy-Con buttons, stick, battery, counter, and three IMU frames', () => {
    const bytes = new Uint8Array(48);
    bytes[0] = 254;
    bytes[1] = 0x80;
    bytes[2] = 0b10001000;
    setStick(bytes, 5, 2048, 2048);
    setStick(bytes, 8, 4095, 0);
    bytes[12] = 0x10;
    new DataView(bytes.buffer).setInt16(18, 1000, true);
    new DataView(bytes.buffer).setInt16(20, -500, true);
    new DataView(bytes.buffer).setInt16(22, 250, true);
    const sample = decodeStandardFullReport(
      0x30,
      new DataView(bytes.buffer),
      'joycon-right',
      'bluetooth',
      100
    );

    expect(sample.packetCounter).toBe(254);
    expect(sample.battery).toEqual({ percentage: 100, charging: false });
    expect(sample.buttons.a).toBe(true);
    expect(sample.buttons.zr).toBe(true);
    expect(sample.sticks.left).toBeUndefined();
    expect(sample.sticks.right?.x).toBe(1);
    expect(sample.sticks.right?.y).toBe(-1);
    expect(sample.imuFrames).toHaveLength(3);
    expect(sample.imuFrames[0].gyroscope.x).toBeCloseTo(61.03, 2);
    expect(sample.imuFrames[0].gyroscope.y).toBeCloseTo(-30.515, 3);
    expect(sample.imuFrames[0].gyroscope.z).toBeCloseTo(15.2575, 3);
  });

  it.each([
    [0x00, 0, false],
    [0x20, 25, false],
    [0x40, 50, false],
    [0x60, 75, false],
    [0x80, 100, false],
    [0x90, 100, true],
  ])('decodes battery byte 0x%s as %s%%', (batteryByte, percentage, charging) => {
    const bytes = new Uint8Array(48);
    bytes[1] = batteryByte;
    const sample = decodeStandardFullReport(
      0x30,
      new DataView(bytes.buffer),
      'joycon-left',
      'bluetooth'
    );
    expect(sample.battery).toEqual({ percentage, charging });
  });

  it('rejects malformed reports', () => {
    expect(() =>
      decodeStandardFullReport(0x30, new DataView(new ArrayBuffer(20)), 'joycon-left', 'bluetooth')
    ).toThrow(/Malformed/);
  });

  it('clamps nominal stick normalization', () => {
    expect(normalizeStick({ x: 9999, y: -10 })).toEqual({ x: 1, y: -1 });
  });

  it('normalizes each side of a calibrated center using its measured range', () => {
    const calibration = {
      x: { minimum: 1300, center: 2100, maximum: 3100 },
      y: { minimum: 1200, center: 2000, maximum: 2800 },
    };

    expect(normalizeStick({ x: 2100, y: 2000 }, calibration)).toEqual({ x: 0, y: 0 });
    expect(normalizeStick({ x: 2600, y: 1600 }, calibration)).toEqual({ x: 0.5, y: -0.5 });
    expect(normalizeStick({ x: 5000, y: -100 }, calibration)).toEqual({ x: 1, y: -1 });
  });

  it('applies supplied calibration while preserving raw stick values', () => {
    const bytes = new Uint8Array(48);
    setStick(bytes, 5, 2100, 2000);
    const calibration = {
      left: {
        x: { minimum: 1300, center: 2100, maximum: 3100 },
        y: { minimum: 1200, center: 2000, maximum: 2800 },
      },
    };
    const sample = decodeStandardFullReport(
      0x30,
      new DataView(bytes.buffer),
      'joycon-left',
      'bluetooth',
      100,
      calibration
    );

    expect(sample.rawSticks.left).toEqual({ x: 2100, y: 2000 });
    expect(sample.sticks.left).toEqual({ x: 0, y: 0 });
  });

  it('allows scoped SPI settings access but blocks erase and firmware commands', () => {
    expect(buildSubcommandPacket(0, 0x10, [0x50, 0x60, 0, 0, 6])[9]).toBe(0x10);
    expect(buildSubcommandPacket(0, 0x11, [0x50, 0x60, 0, 0, 1, 0])[9]).toBe(0x11);
    expect(() => buildSubcommandPacket(0, 0x12, [])).toThrow(/Blocked unsafe/);
  });
});
