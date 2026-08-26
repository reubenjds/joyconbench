import { describe, expect, it } from 'vitest';
import { decodeStickCalibration, resolveStickCalibration } from './calibration';

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

    expect(resolved.left?.x.center).toBe(2200);
    expect(resolved.right).toBeUndefined();
  });

  it('rejects corrupt calibration ranges', () => {
    expect(decodeStickCalibration(new Uint8Array(9), 'left')).toBeNull();
  });
});
