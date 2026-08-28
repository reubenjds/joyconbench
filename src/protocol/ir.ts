export const IR_WIDTH = 80;
export const IR_HEIGHT = 60;
export const IR_FRAGMENT_BYTES = 300;
export const IR_FRAGMENT_COUNT = 16;
export const IR_MCU_PAYLOAD_BYTES = 38;

export const MCU_REPORT_OFFSET = 48;
export const MCU_MODE_OFFSET = 55;
export const IR_FRAGMENT_OFFSET = 51;
export const IR_PIXELS_OFFSET = 58;
export const MCU_REPORT_STATE = 0x01;
export const MCU_REPORT_IR_DATA = 0x03;

export interface IrFragment {
  index: number;
  pixels: Uint8Array;
}

export interface IrAssemblyResult {
  frame: Uint8Array | null;
  nextFragment: number;
  resend: boolean;
  droppedFragments: number;
}

type IrRegister = readonly [address: number, value: number];

const STEP_ONE_REGISTERS: readonly IrRegister[] = [
  [0x2e00, 0x64],
  [0x3001, 0x90],
  [0x3101, 0x24],
  [0x3201, 0x00],
  [0x1000, 0x00],
  [0x2e01, 0x10],
  [0x2f01, 0x00],
  [0x0e00, 0x03],
  [0x4301, 0xc8],
];

const STEP_TWO_REGISTERS: readonly IrRegister[] = [
  [0x1100, 0x0f],
  [0x1200, 0x10],
  [0x2d00, 0x00],
  [0x6701, 0x01],
  [0x6801, 0x23],
  [0x6901, 0x44],
  [0x0400, 0x2d],
  [0x0700, 0x01],
];

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
  payload.set([0x21, 0x00, 0x05]);
  payload[37] = calculateMcuCrc(payload.slice(1, 37));
  return payload;
}

export function buildIrModeConfig() {
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  payload.set([0x23, 0x01, 0x07, 0x0f, 0x00, 0x05, 0x00, 0x18]);
  payload[37] = calculateMcuCrc(payload.slice(1, 37));
  return payload;
}

export function buildIrRegisterConfig(step: 1 | 2) {
  const registers = step === 1 ? STEP_ONE_REGISTERS : STEP_TWO_REGISTERS;
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  payload.set([0x23, 0x04, registers.length]);
  registers.forEach(([address, value], index) => {
    const offset = 3 + index * 3;
    payload[offset] = address & 0xff;
    payload[offset + 1] = address >> 8;
    payload[offset + 2] = value;
  });
  payload[37] = calculateMcuCrc(payload.slice(1, 37));
  return payload;
}

export function buildIrHandshakePoll() {
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  payload[0] = 0x02;
  finishPoll(payload);
  return payload;
}

export function buildIrFragmentPoll(fragment: number, resend = false) {
  if (!Number.isInteger(fragment) || fragment < 0 || fragment >= IR_FRAGMENT_COUNT) {
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

export function parseIrFragment(data: DataView): IrFragment | null {
  if (data.byteLength < IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES) return null;
  if (data.getUint8(MCU_REPORT_OFFSET) !== MCU_REPORT_IR_DATA) return null;
  const index = data.getUint8(IR_FRAGMENT_OFFSET);
  if (index >= IR_FRAGMENT_COUNT) return null;
  return {
    index,
    pixels: new Uint8Array(
      data.buffer.slice(
        data.byteOffset + IR_PIXELS_OFFSET,
        data.byteOffset + IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES
      )
    ),
  };
}

export class IrFrameAssembler {
  private readonly pixels = new Uint8Array(IR_WIDTH * IR_HEIGHT);
  private expectedFragment = 0;

  get nextFragment() {
    return this.expectedFragment;
  }

  reset() {
    this.pixels.fill(0);
    this.expectedFragment = 0;
  }

  accept(fragment: IrFragment): IrAssemblyResult {
    if (fragment.pixels.length !== IR_FRAGMENT_BYTES) {
      return this.result(null, true, 0);
    }
    if (fragment.index !== this.expectedFragment) {
      const previous = (this.expectedFragment + IR_FRAGMENT_COUNT - 1) % IR_FRAGMENT_COUNT;
      if (fragment.index === previous) return this.result(null, false, 0);
      const dropped =
        (fragment.index - this.expectedFragment + IR_FRAGMENT_COUNT) % IR_FRAGMENT_COUNT;
      if (fragment.index === 0) {
        this.reset();
        this.store(fragment);
        this.expectedFragment = 1;
        return this.result(null, false, dropped);
      }
      return this.result(null, true, dropped || 1);
    }

    this.store(fragment);
    if (fragment.index === IR_FRAGMENT_COUNT - 1) {
      const frame = this.pixels.slice();
      this.reset();
      return this.result(frame, false, 0);
    }
    this.expectedFragment += 1;
    return this.result(null, false, 0);
  }

  private store(fragment: IrFragment) {
    this.pixels.set(fragment.pixels, fragment.index * IR_FRAGMENT_BYTES);
  }

  private result(frame: Uint8Array | null, resend: boolean, droppedFragments: number) {
    return { frame, nextFragment: this.expectedFragment, resend, droppedFragments };
  }
}

function finishPoll(payload: Uint8Array) {
  payload[36] = calculateMcuCrc(payload.slice(0, 36));
  payload[37] = 0xff;
}
