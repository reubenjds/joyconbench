import { describe, expect, it } from 'vitest';
import {
  decodeImuCalibration,
  decodeStickCalibration,
  resolveImuCalibration,
  resolveStickCalibration,
} from './calibration';

function packStickValues(values: [number, number, number, number, number, number]) {
  const packed = new Uint8Array(9);
  for (let index = 0; index < values.length; index += 2) {
    const offset = (index / 2) * 3;
    packed[offset] = values[index] & 0xff;
    packed[offset + 1] = ((values[index] >> 8) & 0x0f) | ((values[index + 1] & 0x0f) << 4);
    packed[offset + 2] = (values[index + 1] >> 4) & 0xff;
  }
  return packed;
}

function packImu(values: number[]) {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

describe('stick calibration', () => {
  it('decodes the different left and right packed layouts', () => {
    const left = decodeStickCalibration(packStickValues([1000, 900, 2100, 2000, 800, 700]), 'left');
    const right = decodeStickCalibration(
      packStickValues([2100, 2000, 800, 700, 1000, 900]),
      'right'
    );

    expect(left).toEqual({
      x: { minimum: 1300, center: 2100, maximum: 3100 },
      y: { minimum: 1300, center: 2000, maximum: 2900 },
    });
    expect(right).toEqual(left);
  });

  it('prefers valid user calibration and falls back to factory calibration', () => {
    const factoryLeft = packStickValues([1000, 900, 2100, 2000, 800, 700]);
    const factoryRight = packStickValues([2000, 2050, 700, 650, 900, 850]);
    const user = new Uint8Array(22).fill(0xff);
    user.set([0xb2, 0xa1], 0);
    user.set(packStickValues([900, 800, 2200, 1900, 700, 600]), 2);

    const resolved = resolveStickCalibration('joycon-left', factoryLeft, factoryRight, user);

    expect(resolved.calibration.left?.x.center).toBe(2200);
    expect(resolved.calibration.right).toBeUndefined();
    expect(resolved.sources.left).toBe('user');
  });

  it('rejects corrupt calibration ranges', () => {
    expect(decodeStickCalibration(new Uint8Array(9), 'left')).toBeNull();
  });
});

describe('IMU calibration', () => {
  const factory = packImu([-120, 20, 80, 16384, 16400, 16320, -30, 15, 45, 13371, 13380, 13360]);

  it('decodes signed offsets and validates all scale divisors', () => {
    const decoded = decodeImuCalibration(factory);
    expect(decoded?.accelerometer.x).toEqual({ offset: -120, scale: 16384 });
    expect(decoded?.gyroscope.z).toEqual({ offset: 45, scale: 13360 });
    const invalid = factory.slice();
    new DataView(invalid.buffer).setInt16(18, -30, true);
    expect(decodeImuCalibration(invalid)).toBeNull();
  });

  it('prefers valid user calibration, falls back to factory, then nominal', () => {
    const user = new Uint8Array(26).fill(0xff);
    const userData = packImu([1, 2, 3, 16001, 16002, 16003, 4, 5, 6, 13004, 13005, 13006]);
    user.set([0xb2, 0xa1], 0);
    user.set(userData, 2);
    expect(resolveImuCalibration(factory, user).source).toBe('user');
    expect(resolveImuCalibration(factory, new Uint8Array(26).fill(0xff)).source).toBe('factory');
    expect(resolveImuCalibration(new Uint8Array(24), new Uint8Array(26).fill(0xff)).source).toBe(
      'nominal'
    );
  });
});
