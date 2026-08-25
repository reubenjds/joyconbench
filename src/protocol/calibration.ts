import type {
  ControllerKind,
  StickAxisCalibration,
  StickCalibration,
  StickCalibrationSet,
  StickId,
} from '../types/controller';

export const FACTORY_LEFT_STICK_REGION = {
  name: 'factory-left-stick-calibration',
  address: 0x603d,
  length: 9,
} as const;

export const FACTORY_RIGHT_STICK_REGION = {
  name: 'factory-right-stick-calibration',
  address: 0x6046,
  length: 9,
} as const;

export const USER_STICK_REGION = {
  name: 'user-stick-calibration',
  address: 0x8010,
  length: 22,
} as const;

export const USER_MOTION_REGION = {
  name: 'user-motion-calibration',
  address: 0x8026,
  length: 26,
} as const;

const USER_CALIBRATION_MAGIC = [0xb2, 0xa1] as const;

export function decodeStickCalibration(data: Uint8Array, stick: StickId) {
  if (data.length !== 9) throw new Error('Stick calibration must contain nine bytes.');
  const values = unpackStickValues(data);
  const calibration =
    stick === 'left'
      ? buildCalibration(values[2], values[3], values[4], values[5], values[0], values[1])
      : buildCalibration(values[0], values[1], values[2], values[3], values[4], values[5]);
  return isValidStickCalibration(calibration) ? calibration : null;
}

export function resolveStickCalibration(
  kind: ControllerKind,
  factoryLeft: Uint8Array,
  factoryRight: Uint8Array,
  user: Uint8Array
): StickCalibrationSet {
  if (user.length !== USER_STICK_REGION.length) {
    throw new Error('User stick calibration is incomplete.');
  }

  const resolved: StickCalibrationSet = {};
  if (kind !== 'joycon-right') {
    resolved.left =
      decodeUserStickCalibration(user, 'left') ??
      decodeStickCalibration(factoryLeft, 'left') ??
      undefined;
  }
  if (kind !== 'joycon-left') {
    resolved.right =
      decodeUserStickCalibration(user, 'right') ??
      decodeStickCalibration(factoryRight, 'right') ??
      undefined;
  }
  return resolved;
}

function decodeUserStickCalibration(data: Uint8Array, stick: StickId) {
  const magicOffset = stick === 'left' ? 0 : 11;
  if (
    data[magicOffset] !== USER_CALIBRATION_MAGIC[0] ||
    data[magicOffset + 1] !== USER_CALIBRATION_MAGIC[1]
  ) {
    return null;
  }
  return decodeStickCalibration(data.slice(magicOffset + 2, magicOffset + 11), stick);
}

function unpackStickValues(data: Uint8Array) {
  const values: number[] = [];
  for (let offset = 0; offset < data.length; offset += 3) {
    values.push(data[offset] | ((data[offset + 1] & 0x0f) << 8));
    values.push((data[offset + 1] >> 4) | (data[offset + 2] << 4));
  }
  return values as [number, number, number, number, number, number];
}

function buildCalibration(
  centerX: number,
  centerY: number,
  minimumDeltaX: number,
  minimumDeltaY: number,
  maximumDeltaX: number,
  maximumDeltaY: number
): StickCalibration {
  return {
    x: axisCalibration(centerX, minimumDeltaX, maximumDeltaX),
    y: axisCalibration(centerY, minimumDeltaY, maximumDeltaY),
  };
}

function axisCalibration(
  center: number,
  minimumDelta: number,
  maximumDelta: number
): StickAxisCalibration {
  return {
    minimum: center - minimumDelta,
    center,
    maximum: center + maximumDelta,
  };
}

function isValidStickCalibration(calibration: StickCalibration) {
  return [calibration.x, calibration.y].every(
    (axis) =>
      Number.isInteger(axis.minimum) &&
      axis.minimum >= 0 &&
      axis.minimum < axis.center &&
      axis.center < axis.maximum &&
      axis.maximum <= 0x0fff
  );
}
