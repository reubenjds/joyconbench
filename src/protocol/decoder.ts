import {
  EMPTY_BUTTONS,
  type BatteryStatus,
  type ConnectionKind,
  type ControllerCalibration,
  type ControllerKind,
  type ControllerSample,
  type ImuFrame,
  type StickCalibration,
  type Vector2,
  type Vector3,
} from '../types/controller';
import { NOMINAL_CONTROLLER_CALIBRATION } from './calibration';
import { INPUT_REPORT_NFC_IR, INPUT_REPORT_STANDARD_FULL } from './nintendo';

const ACCELEROMETER_G_PER_UNIT = 0.000244;
const GYROSCOPE_DPS_PER_UNIT = 1 / 14.247;

function bit(value: number, index: number) {
  return (value & (1 << index)) !== 0;
}

function readStick(data: DataView, offset: number): Vector2 {
  const first = data.getUint8(offset);
  const second = data.getUint8(offset + 1);
  const third = data.getUint8(offset + 2);
  return {
    x: first | ((second & 0x0f) << 8),
    y: (second >> 4) | (third << 4),
  };
}

export function normalizeStick(value: Vector2, calibration?: StickCalibration): Vector2 {
  if (!calibration) {
    const normalizeAxis = (axis: number) => Math.max(-1, Math.min(1, (axis - 2048) / 2047));
    return { x: normalizeAxis(value.x), y: normalizeAxis(value.y) };
  }
  return {
    x: normalizeCalibratedAxis(value.x, calibration.x),
    y: normalizeCalibratedAxis(value.y, calibration.y),
  };
}

function normalizeCalibratedAxis(value: number, calibration: StickCalibration['x']): number {
  const delta = value - calibration.center;
  const range =
    delta >= 0
      ? calibration.maximum - calibration.center
      : calibration.center - calibration.minimum;
  return Math.max(-1, Math.min(1, delta / range));
}

function readRawVector(data: DataView, offset: number): Vector3 {
  return {
    x: data.getInt16(offset, true),
    y: data.getInt16(offset + 2, true),
    z: data.getInt16(offset + 4, true),
  };
}

function calibrateVector(
  vector: Vector3,
  calibration: ControllerCalibration['imu']['accelerometer'],
  kind: 'accelerometer' | 'gyroscope'
): Vector3 {
  const axes = ['x', 'y', 'z'] as const;
  return Object.fromEntries(
    axes.map((axis) => {
      const { offset, scale } = calibration[axis];
      const divisor = scale - offset;
      const calibrated =
        kind === 'gyroscope'
          ? ((vector[axis] - offset) * scale) / divisor
          : (vector[axis] * scale) / divisor;
      return [
        axis,
        calibrated * (kind === 'gyroscope' ? GYROSCOPE_DPS_PER_UNIT : ACCELEROMETER_G_PER_UNIT),
      ];
    })
  ) as Vector3;
}

function readBattery(value: number): BatteryStatus {
  const nibble = value >> 4;
  const level = nibble & 0x0e;
  const percentage = level >= 8 ? 100 : level >= 6 ? 75 : level >= 4 ? 50 : level >= 2 ? 25 : 0;
  return { percentage, charging: (nibble & 0x01) !== 0 };
}

function decodeImu(
  data: DataView,
  calibration: ControllerCalibration['imu']
): readonly [ImuFrame, ImuFrame, ImuFrame] {
  const frames = [0, 1, 2].map((index) => {
    const offset = 12 + index * 12;
    return {
      offsetMs: index * 5,
      accelerometer: calibrateVector(
        readRawVector(data, offset),
        calibration.accelerometer,
        'accelerometer'
      ),
      gyroscope: calibrateVector(
        readRawVector(data, offset + 6),
        calibration.gyroscope,
        'gyroscope'
      ),
    };
  });
  return frames as unknown as readonly [ImuFrame, ImuFrame, ImuFrame];
}

export function decodeStandardFullReport(
  reportId: number,
  data: DataView,
  kind: ControllerKind,
  connection: ConnectionKind,
  timestamp = performance.now(),
  calibration: ControllerCalibration = NOMINAL_CONTROLLER_CALIBRATION
): ControllerSample {
  if (reportId !== INPUT_REPORT_STANDARD_FULL && reportId !== INPUT_REPORT_NFC_IR) {
    throw new Error(`Unsupported input report 0x${reportId.toString(16)}`);
  }
  if (data.byteLength < 48) throw new Error('Malformed standard full input report');

  const right = data.getUint8(2);
  const shared = data.getUint8(3);
  const left = data.getUint8(4);
  const buttons = {
    ...EMPTY_BUTTONS,
    y: bit(right, 0),
    x: bit(right, 1),
    b: bit(right, 2),
    a: bit(right, 3),
    srRight: bit(right, 4),
    slRight: bit(right, 5),
    r: bit(right, 6),
    zr: bit(right, 7),
    minus: bit(shared, 0),
    plus: bit(shared, 1),
    rightStick: bit(shared, 2),
    leftStick: bit(shared, 3),
    home: bit(shared, 4),
    capture: bit(shared, 5),
    down: bit(left, 0),
    up: bit(left, 1),
    right: bit(left, 2),
    left: bit(left, 3),
    srLeft: bit(left, 4),
    slLeft: bit(left, 5),
    l: bit(left, 6),
    zl: bit(left, 7),
  };

  const leftStick = readStick(data, 5);
  const rightStick = readStick(data, 8);
  const rawSticks = kind === 'joycon-left' ? { left: leftStick } : { right: rightStick };

  return {
    timestamp,
    buttons,
    rawSticks,
    sticks: Object.fromEntries(
      Object.entries(rawSticks).map(([id, value]) => [
        id,
        normalizeStick(value, calibration.sticks[id as keyof ControllerCalibration['sticks']]),
      ])
    ),
    imuFrames: decodeImu(data, calibration.imu),
    battery: readBattery(data.getUint8(1)),
    reportTimer: data.getUint8(0),
    connection,
    calibration: calibration.sources,
  };
}
