import type {
  ControllerKind,
  CalibrationSource,
  ControllerCalibration,
  ImuCalibration,
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

export const FACTORY_MOTION_REGION = {
  name: 'factory-motion-calibration',
  address: 0x6020,
  length: 24,
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

export interface ResolvedStickCalibration {
  calibration: StickCalibrationSet;
  sources: Partial<Record<StickId, CalibrationSource>>;
}

export interface ResolvedImuCalibration {
  calibration: ImuCalibration;
  source: CalibrationSource;
}

export const NOMINAL_IMU_CALIBRATION: ImuCalibration = {
  accelerometer: {
    x: { offset: 0, scale: 16384 },
    y: { offset: 0, scale: 16384 },
    z: { offset: 0, scale: 16384 },
  },
  gyroscope: {
    x: { offset: 0, scale: 13371 },
    y: { offset: 0, scale: 13371 },
    z: { offset: 0, scale: 13371 },
  },
};

export const NOMINAL_CONTROLLER_CALIBRATION: ControllerCalibration = {
  sticks: {},
  imu: NOMINAL_IMU_CALIBRATION,
  sources: { sticks: {}, imu: 'nominal' },
};

export function resolveStickCalibration(
  kind: ControllerKind,
  factoryLeft: Uint8Array,
  factoryRight: Uint8Array,
  user: Uint8Array
): ResolvedStickCalibration {
  if (user.length !== USER_STICK_REGION.length) {
    throw new Error('User stick calibration is incomplete.');
  }

  const resolved: StickCalibrationSet = {};
  const sources: Partial<Record<StickId, CalibrationSource>> = {};
  if (kind === 'joycon-left') {
    const userCalibration = decodeUserStickCalibration(user, 'left');
    const factoryCalibration = decodeStickCalibration(factoryLeft, 'left');
    resolved.left = userCalibration ?? factoryCalibration ?? undefined;
    sources.left = userCalibration ? 'user' : factoryCalibration ? 'factory' : 'nominal';
  } else {
    const userCalibration = decodeUserStickCalibration(user, 'right');
    const factoryCalibration = decodeStickCalibration(factoryRight, 'right');
    resolved.right = userCalibration ?? factoryCalibration ?? undefined;
    sources.right = userCalibration ? 'user' : factoryCalibration ? 'factory' : 'nominal';
  }
  return { calibration: resolved, sources };
}

export function decodeImuCalibration(data: Uint8Array): ImuCalibration | null {
  if (data.length !== FACTORY_MOTION_REGION.length) {
    throw new Error('Motion calibration must contain 24 bytes.');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const axes = ['x', 'y', 'z'] as const;
  const calibration: ImuCalibration = {
    accelerometer: {
      x: { offset: 0, scale: 0 },
      y: { offset: 0, scale: 0 },
      z: { offset: 0, scale: 0 },
    },
    gyroscope: {
      x: { offset: 0, scale: 0 },
      y: { offset: 0, scale: 0 },
      z: { offset: 0, scale: 0 },
    },
  };
  axes.forEach((axis, index) => {
    calibration.accelerometer[axis] = {
      offset: view.getInt16(index * 2, true),
      scale: view.getInt16(6 + index * 2, true),
    };
    calibration.gyroscope[axis] = {
      offset: view.getInt16(12 + index * 2, true),
      scale: view.getInt16(18 + index * 2, true),
    };
  });
  return isValidImuCalibration(calibration) ? calibration : null;
}

export function resolveImuCalibration(
  factory: Uint8Array,
  user: Uint8Array
): ResolvedImuCalibration {
  if (user.length !== USER_MOTION_REGION.length) {
    throw new Error('User motion calibration is incomplete.');
  }
  const userCalibration =
    user[0] === USER_CALIBRATION_MAGIC[0] && user[1] === USER_CALIBRATION_MAGIC[1]
      ? decodeImuCalibration(user.slice(2))
      : null;
  if (userCalibration) return { calibration: userCalibration, source: 'user' };
  const factoryCalibration = decodeImuCalibration(factory);
  if (factoryCalibration) return { calibration: factoryCalibration, source: 'factory' };
  return { calibration: NOMINAL_IMU_CALIBRATION, source: 'nominal' };
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

function isValidImuCalibration(calibration: ImuCalibration) {
  return (['accelerometer', 'gyroscope'] as const).every((sensor) =>
    (['x', 'y', 'z'] as const).every((axis) => {
      const value = calibration[sensor][axis];
      const divisor = value.scale - value.offset;
      return Number.isInteger(value.offset) && Number.isInteger(value.scale) && divisor >= 1024;
    })
  );
}
