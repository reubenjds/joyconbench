import type { IrCameraSettings, IrResolution } from '../types/controller';

export const IR_FRAGMENT_BYTES = 300;
export const IR_MCU_PAYLOAD_BYTES = 38;

export const MCU_REPORT_OFFSET = 48;
export const MCU_MODE_OFFSET = 55;
export const IR_FRAGMENT_OFFSET = 51;
export const IR_AVERAGE_INTENSITY_OFFSET = 52;
export const IR_EXTERNAL_FILTER_INTENSITY_OFFSET = 53;
export const IR_WHITE_PIXELS_OFFSET = 54;
export const IR_AMBIENT_NOISE_PIXELS_OFFSET = 56;
export const IR_PIXELS_OFFSET = 58;

/** MCU report types found at byte 49 of an input report 0x31 (byte 48 once WebHID drops the id). */
export const MCU_REPORT_BUSY = 0x00;
export const MCU_REPORT_STATE = 0x01;
export const MCU_REPORT_IR_DATA = 0x03;
export const MCU_REPORT_IR_STATUS = 0x13;
export const MCU_REPORT_EMPTY = 0xff;

export const MCU_MODE_STANDBY = 0x01;
export const MCU_MODE_IR = 0x05;
export const IR_MODE_IMAGE_TRANSFER = 0x07;

/** MCU configuration acknowledgements returned in a subcommand 0x21 reply. */
export const MCU_ACK_IR_MODE_SET = 0x0b;
export const MCU_ACK_REGISTERS_SET = MCU_REPORT_IR_STATUS;
export const MCU_ACK_CONFIG_WRITE = 0x23;

export interface IrResolutionMode {
  id: IrResolution;
  width: number;
  height: number;
  register: number;
  fragmentCount: number;
  bufferUpdateTime: number;
}

export const IR_RESOLUTION_MODES: Record<IrResolution, IrResolutionMode> = {
  '40x30': {
    id: '40x30',
    width: 40,
    height: 30,
    register: 0x69,
    fragmentCount: 4,
    bufferUpdateTime: 0x2d,
  },
  '80x60': {
    id: '80x60',
    width: 80,
    height: 60,
    register: 0x64,
    fragmentCount: 16,
    bufferUpdateTime: 0x32,
  },
  '160x120': {
    id: '160x120',
    width: 160,
    height: 120,
    register: 0x50,
    fragmentCount: 64,
    bufferUpdateTime: 0x32,
  },
  '320x240': {
    id: '320x240',
    width: 320,
    height: 240,
    register: 0x00,
    fragmentCount: 256,
    bufferUpdateTime: 0x32,
  },
};

export const DEFAULT_IR_SETTINGS: IrCameraSettings = {
  resolution: '80x60',
  exposureMicroseconds: 300,
  digitalGain: 2,
  autoExposure: false,
  farLedEnabled: true,
  nearLedEnabled: true,
  farLedIntensity: 15,
  nearLedIntensity: 16,
  flashlight: false,
  strobe: false,
  externalLightFilter: true,
  horizontalFlip: false,
  denoiseEnabled: true,
  denoiseEdgeSmoothing: 0x23,
  denoiseColorInterpolation: 0x44,
};

/** Backward-compatible aliases for the default stream mode. */
export const IR_WIDTH = IR_RESOLUTION_MODES['80x60'].width;
export const IR_HEIGHT = IR_RESOLUTION_MODES['80x60'].height;
export const IR_FRAGMENT_COUNT = IR_RESOLUTION_MODES['80x60'].fragmentCount;

export interface IrFragmentTelemetry {
  averageIntensity: number;
  externalFilterIntensity: number;
  whitePixels: number;
  ambientNoisePixels: number;
}

export interface IrFragment {
  index: number;
  pixels: Uint8Array;
  telemetry?: IrFragmentTelemetry;
}

/**
 * The MCU only advances to the next fragment once the previous one is acknowledged, so every
 * received report has to produce exactly one outgoing 0x11 packet.
 */
export type IrAcknowledgement =
  { kind: 'ack'; fragment: number } | { kind: 'resend'; fragment: number };

export interface IrAssemblyResult {
  frame: Uint8Array | null;
  telemetry: IrFragmentTelemetry | null;
  acknowledgement: IrAcknowledgement;
  droppedFragments: number;
}

type IrRegister = readonly [address: number, value: number];

export function normalizeIrSettings(settings: IrCameraSettings): IrCameraSettings {
  return {
    ...settings,
    autoExposure: settings.resolution === '40x30' ? false : settings.autoExposure,
    exposureMicroseconds: clampInteger(settings.exposureMicroseconds, 0, 600),
    digitalGain: clampInteger(settings.digitalGain, 1, 20),
    farLedIntensity: clampInteger(settings.farLedIntensity, 0, 15),
    nearLedIntensity: clampInteger(settings.nearLedIntensity, 0, 16),
    denoiseEdgeSmoothing: clampInteger(settings.denoiseEdgeSmoothing, 0, 255),
    denoiseColorInterpolation: clampInteger(settings.denoiseColorInterpolation, 0, 255),
  };
}

export function calculateMcuCrc(bytes: Uint8Array) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function buildMcuModeConfig() {
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  payload.set([0x21, 0x00, MCU_MODE_IR]);
  sealConfig(payload);
  return payload;
}

export function buildIrModeConfig(fragmentCount = IR_FRAGMENT_COUNT) {
  if (!Number.isInteger(fragmentCount) || fragmentCount < 1 || fragmentCount > 256) {
    throw new Error('IR fragment count must be between 1 and 256.');
  }
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  // 0x23 0x01: IR mode 0x07 (image transfer), final fragment index, required MCU firmware 5.18.
  payload.set([0x23, 0x01, IR_MODE_IMAGE_TRANSFER, fragmentCount - 1, 0x00, 0x05, 0x00, 0x18]);
  sealConfig(payload);
  return payload;
}

export function buildIrRegisterConfig(
  step: 1 | 2,
  inputSettings: IrCameraSettings = DEFAULT_IR_SETTINGS
) {
  const settings = normalizeIrSettings(inputSettings);
  const mode = IR_RESOLUTION_MODES[settings.resolution];
  const exposure = encodeExposure(settings.exposureMicroseconds);
  const gain = settings.autoExposure ? 1 : settings.digitalGain;
  const registers: readonly IrRegister[] =
    step === 1
      ? [
          [0x2e00, mode.register],
          [0x3001, exposure & 0xff],
          [0x3101, exposure >> 8],
          [0x3201, 0x00],
          [0x1000, ledMode(settings)],
          [0x2e01, (gain & 0x0f) << 4],
          [0x2f01, (gain & 0xf0) >> 4],
          [0x0e00, externalFilterMode(settings)],
          [0x4301, 0xc8],
        ]
      : [
          [0x1100, settings.farLedIntensity],
          [0x1200, settings.nearLedIntensity],
          [0x2d00, settings.horizontalFlip ? 0x02 : 0x00],
          [0x6701, settings.denoiseEnabled ? 0x01 : 0x00],
          [0x6801, settings.denoiseEdgeSmoothing],
          [0x6901, settings.denoiseColorInterpolation],
          [0x0400, mode.bufferUpdateTime],
          [0x0700, 0x01],
        ];
  return buildRegisterWrite(registers);
}

export function buildExposureRegisterConfig(exposureMicroseconds: number) {
  const exposure = encodeExposure(exposureMicroseconds);
  return buildRegisterWrite([
    [0x3001, exposure & 0xff],
    [0x3101, exposure >> 8],
    [0x0700, 0x01],
  ]);
}

/** Output report 0x11 command 0x03 with argument 0x02: report the current IR mode. */
export function buildIrHandshakePoll() {
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  payload[0] = 0x02;
  finishPoll(payload);
  return payload;
}

/**
 * Output report 0x11 command 0x03. An acknowledgement names the fragment that was just received.
 * A resend request names the fragment the MCU should send next, not the one that went missing.
 */
export function buildIrFragmentPoll(fragment: number, resend = false, fragmentCount = 256) {
  if (!Number.isInteger(fragment) || fragment < 0 || fragment >= fragmentCount) {
    throw new Error('Invalid IR fragment number.');
  }
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  if (resend) {
    payload[1] = 0x01;
    payload[2] = fragment;
  } else {
    payload[3] = fragment;
  }
  finishPoll(payload);
  return payload;
}

export function buildAcknowledgementPoll(acknowledgement: IrAcknowledgement, fragmentCount = 256) {
  return buildIrFragmentPoll(
    acknowledgement.fragment,
    acknowledgement.kind === 'resend',
    fragmentCount
  );
}

export function parseIrFragment(
  data: DataView,
  fragmentCount = IR_FRAGMENT_COUNT
): IrFragment | null {
  if (data.byteLength < IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES) return null;
  if (data.getUint8(MCU_REPORT_OFFSET) !== MCU_REPORT_IR_DATA) return null;
  const index = data.getUint8(IR_FRAGMENT_OFFSET);
  if (index >= fragmentCount) return null;
  return {
    index,
    pixels: new Uint8Array(
      data.buffer.slice(
        data.byteOffset + IR_PIXELS_OFFSET,
        data.byteOffset + IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES
      )
    ),
    telemetry: {
      averageIntensity: data.getUint8(IR_AVERAGE_INTENSITY_OFFSET),
      externalFilterIntensity: data.getUint8(IR_EXTERNAL_FILTER_INTENSITY_OFFSET),
      whitePixels: data.getUint16(IR_WHITE_PIXELS_OFFSET, true),
      ambientNoisePixels: data.getUint16(IR_AMBIENT_NOISE_PIXELS_OFFSET, true),
    },
  };
}

export class IrFrameAssembler {
  private readonly pixels: Uint8Array;
  private lastFragment: number;
  private awaitingResend = false;

  constructor(
    readonly width = IR_WIDTH,
    readonly height = IR_HEIGHT,
    readonly fragmentCount = IR_FRAGMENT_COUNT
  ) {
    if (width * height !== fragmentCount * IR_FRAGMENT_BYTES) {
      throw new Error('IR frame dimensions do not match its fragment count.');
    }
    this.pixels = new Uint8Array(width * height);
    this.lastFragment = fragmentCount - 1;
  }

  /** The fragment the MCU is expected to send next. */
  get nextFragment() {
    return (this.lastFragment + 1) % this.fragmentCount;
  }

  reset() {
    this.pixels.fill(0);
    this.lastFragment = this.fragmentCount - 1;
    this.awaitingResend = false;
  }

  /** Re-acknowledge the last fragment, used when the MCU sends an empty IR report. */
  repeat(): IrAcknowledgement {
    return { kind: 'ack', fragment: this.lastFragment };
  }

  /** Ask the MCU to restart from the fragment we are waiting for. */
  resend(): IrAcknowledgement {
    return { kind: 'resend', fragment: this.nextFragment };
  }

  accept(fragment: IrFragment): IrAssemblyResult {
    if (fragment.pixels.length !== IR_FRAGMENT_BYTES) {
      return {
        frame: null,
        telemetry: null,
        acknowledgement: this.repeat(),
        droppedFragments: 0,
      };
    }

    if (fragment.index === this.lastFragment) {
      this.awaitingResend = false;
      return {
        frame: null,
        telemetry: null,
        acknowledgement: this.repeat(),
        droppedFragments: 0,
      };
    }

    const expected = this.nextFragment;
    const dropped = (fragment.index - expected + this.fragmentCount) % this.fragmentCount;
    this.store(fragment);

    if (fragment.index !== expected && !this.awaitingResend) {
      this.awaitingResend = true;
      this.lastFragment = fragment.index;
      return {
        frame: null,
        telemetry: null,
        acknowledgement: { kind: 'resend', fragment: expected },
        droppedFragments: dropped,
      };
    }

    this.awaitingResend = false;
    this.lastFragment = fragment.index;
    const complete = fragment.index === this.fragmentCount - 1;
    return {
      frame: complete ? this.pixels.slice() : null,
      telemetry: complete ? (fragment.telemetry ?? EMPTY_TELEMETRY) : null,
      acknowledgement: { kind: 'ack', fragment: fragment.index },
      droppedFragments: dropped,
    };
  }

  private store(fragment: IrFragment) {
    this.pixels.set(fragment.pixels, fragment.index * IR_FRAGMENT_BYTES);
  }
}

function buildRegisterWrite(registers: readonly IrRegister[]) {
  if (registers.length > 9)
    throw new Error('A Joy-Con IR register write supports at most 9 values.');
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  payload.set([0x23, 0x04, registers.length]);
  registers.forEach(([address, value], index) => {
    const offset = 3 + index * 3;
    payload[offset] = address & 0xff;
    payload[offset + 1] = address >> 8;
    payload[offset + 2] = value;
  });
  sealConfig(payload);
  return payload;
}

const EMPTY_TELEMETRY: IrFragmentTelemetry = {
  averageIntensity: 0,
  externalFilterIntensity: 0,
  whitePixels: 0,
  ambientNoisePixels: 0,
};

function encodeExposure(microseconds: number) {
  return Math.round(clampInteger(microseconds, 0, 600) * 31.2);
}

function ledMode(settings: IrCameraSettings) {
  let value = 0;
  // The sensor register names the enabled group indirectly: disabling near/wide sets bit 5,
  // while disabling far/narrow sets bit 4.
  if (!settings.nearLedEnabled) value |= 0x20;
  if (!settings.farLedEnabled) value |= 0x10;
  if (settings.flashlight) value |= 0x01;
  if (settings.strobe) value |= 0x80;
  return value;
}

function externalFilterMode(settings: IrCameraSettings) {
  return !settings.flashlight && (settings.externalLightFilter || settings.strobe) ? 0x03 : 0x00;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function sealConfig(payload: Uint8Array) {
  payload[37] = calculateMcuCrc(payload.slice(1, 37));
}

function finishPoll(payload: Uint8Array) {
  payload[36] = calculateMcuCrc(payload.slice(0, 36));
  payload[37] = 0xff;
}
