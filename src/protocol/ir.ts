export const IR_WIDTH = 80;
export const IR_HEIGHT = 60;
export const IR_FRAGMENT_BYTES = 300;
export const IR_FRAGMENT_COUNT = 16;
export const IR_MCU_PAYLOAD_BYTES = 38;

export const MCU_REPORT_OFFSET = 48;
export const MCU_MODE_OFFSET = 55;
export const IR_FRAGMENT_OFFSET = 51;
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

export interface IrFragment {
  index: number;
  pixels: Uint8Array;
}

/**
 * The MCU only advances to the next fragment once the previous one is acknowledged, so every
 * received report has to produce exactly one outgoing 0x11 packet.
 */
export type IrAcknowledgement =
  { kind: 'ack'; fragment: number } | { kind: 'resend'; fragment: number };

export interface IrAssemblyResult {
  frame: Uint8Array | null;
  acknowledgement: IrAcknowledgement;
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
  payload.set([0x21, 0x00, MCU_MODE_IR]);
  payload[37] = calculateMcuCrc(payload.slice(1, 37));
  return payload;
}

export function buildIrModeConfig() {
  const payload = new Uint8Array(IR_MCU_PAYLOAD_BYTES);
  // 0x23 0x01: IR mode 0x07 (image transfer), 15 extra fragments, required MCU firmware 5.18.
  payload.set([0x23, 0x01, IR_MODE_IMAGE_TRANSFER, IR_FRAGMENT_COUNT - 1, 0x00, 0x05, 0x00, 0x18]);
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

export function buildAcknowledgementPoll(acknowledgement: IrAcknowledgement) {
  return buildIrFragmentPoll(acknowledgement.fragment, acknowledgement.kind === 'resend');
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
  private lastFragment = IR_FRAGMENT_COUNT - 1;
  private awaitingResend = false;

  /** The fragment the MCU is expected to send next. */
  get nextFragment() {
    return (this.lastFragment + 1) % IR_FRAGMENT_COUNT;
  }

  reset() {
    this.pixels.fill(0);
    this.lastFragment = IR_FRAGMENT_COUNT - 1;
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
      return { frame: null, acknowledgement: this.repeat(), droppedFragments: 0 };
    }

    if (fragment.index === this.lastFragment) {
      // The MCU repeated a fragment because it did not see our acknowledgement.
      this.awaitingResend = false;
      return { frame: null, acknowledgement: this.repeat(), droppedFragments: 0 };
    }

    const expected = this.nextFragment;
    const dropped = (fragment.index - expected + IR_FRAGMENT_COUNT) % IR_FRAGMENT_COUNT;
    this.store(fragment);

    if (fragment.index !== expected && !this.awaitingResend) {
      // Ask for the gap once. Acknowledging instead would make the MCU move on without it.
      this.awaitingResend = true;
      this.lastFragment = fragment.index;
      return {
        frame: null,
        acknowledgement: { kind: 'resend', fragment: expected },
        droppedFragments: dropped,
      };
    }

    this.awaitingResend = false;
    this.lastFragment = fragment.index;
    const frame = fragment.index === IR_FRAGMENT_COUNT - 1 ? this.pixels.slice() : null;
    return {
      frame,
      acknowledgement: { kind: 'ack', fragment: fragment.index },
      droppedFragments: dropped,
    };
  }

  private store(fragment: IrFragment) {
    this.pixels.set(fragment.pixels, fragment.index * IR_FRAGMENT_BYTES);
  }
}

function finishPoll(payload: Uint8Array) {
  payload[36] = calculateMcuCrc(payload.slice(0, 36));
  payload[37] = 0xff;
}
