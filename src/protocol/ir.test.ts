import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IR_SETTINGS,
  IR_FRAGMENT_BYTES,
  IR_FRAGMENT_COUNT,
  IR_PIXELS_OFFSET,
  IR_RESOLUTION_MODES,
  IrFrameAssembler,
  buildIrFragmentPoll,
  buildIrModeConfig,
  buildIrRegisterConfig,
  buildMcuModeConfig,
  calculateMcuCrc,
  parseIrFragment,
} from './ir';

describe('Joy-Con IR protocol', () => {
  it('calculates CRC-8-CCITT and seals MCU payloads', () => {
    expect(calculateMcuCrc(new TextEncoder().encode('123456789'))).toBe(0xf4);

    for (const payload of [
      buildMcuModeConfig(),
      buildIrModeConfig(),
      buildIrRegisterConfig(1),
      buildIrRegisterConfig(2),
    ]) {
      expect(payload).toHaveLength(38);
      expect(payload[37]).toBe(calculateMcuCrc(payload.slice(1, 37)));
    }

    const poll = buildIrFragmentPoll(7);
    expect(poll[3]).toBe(7);
    expect(poll[36]).toBe(calculateMcuCrc(poll.slice(0, 36)));
    expect(poll[37]).toBe(0xff);
  });

  it('parses only complete image-transfer fragments', () => {
    const bytes = new Uint8Array(IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES);
    bytes[48] = 0x03;
    bytes[51] = 4;
    bytes.fill(123, IR_PIXELS_OFFSET);
    expect(parseIrFragment(new DataView(bytes.buffer))).toEqual({
      index: 4,
      pixels: new Uint8Array(IR_FRAGMENT_BYTES).fill(123),
      telemetry: {
        averageIntensity: 0,
        externalFilterIntensity: 0,
        whitePixels: 0,
        ambientNoisePixels: 0,
      },
    });

    bytes[51] = IR_FRAGMENT_COUNT;
    expect(parseIrFragment(new DataView(bytes.buffer))).toBeNull();
    expect(parseIrFragment(new DataView(bytes.buffer, 0, 100))).toBeNull();
  });

  it('assembles a complete 80 by 60 grayscale frame', () => {
    const assembler = new IrFrameAssembler();
    let frame: Uint8Array | null = null;
    for (let index = 0; index < IR_FRAGMENT_COUNT; index += 1) {
      frame = assembler.accept({
        index,
        pixels: new Uint8Array(IR_FRAGMENT_BYTES).fill(index),
      }).frame;
    }

    expect(frame).toHaveLength(80 * 60);
    expect(frame?.[0]).toBe(0);
    expect(frame?.[IR_FRAGMENT_BYTES * 7]).toBe(7);
    expect(frame?.at(-1)).toBe(15);
  });

  it('acknowledges the fragment it received and asks for gaps once', () => {
    const assembler = new IrFrameAssembler();
    const fragment = (index: number) => ({
      index,
      pixels: new Uint8Array(IR_FRAGMENT_BYTES),
    });

    // The acknowledgement names the fragment that arrived, not the one expected next.
    expect(assembler.accept(fragment(0))).toMatchObject({
      acknowledgement: { kind: 'ack', fragment: 0 },
      droppedFragments: 0,
    });
    // A repeat is re-acknowledged so the MCU stops resending it.
    expect(assembler.accept(fragment(0))).toMatchObject({
      acknowledgement: { kind: 'ack', fragment: 0 },
      droppedFragments: 0,
    });
    // A gap asks the MCU to resume from the missing fragment.
    expect(assembler.accept(fragment(3))).toMatchObject({
      acknowledgement: { kind: 'resend', fragment: 1 },
      droppedFragments: 2,
    });
    // But only once, otherwise the stream never advances.
    expect(assembler.accept(fragment(5))).toMatchObject({
      acknowledgement: { kind: 'ack', fragment: 5 },
    });
  });

  it('re-acknowledges the last fragment for empty MCU reports', () => {
    const assembler = new IrFrameAssembler();
    expect(assembler.repeat()).toEqual({ kind: 'ack', fragment: IR_FRAGMENT_COUNT - 1 });
    expect(assembler.resend()).toEqual({ kind: 'resend', fragment: 0 });

    assembler.accept({ index: 0, pixels: new Uint8Array(IR_FRAGMENT_BYTES) });
    expect(assembler.repeat()).toEqual({ kind: 'ack', fragment: 0 });
    expect(assembler.resend()).toEqual({ kind: 'resend', fragment: 1 });
  });

  it('describes image transfer of sixteen fragments in the IR mode payload', () => {
    const payload = buildIrModeConfig();
    expect([...payload.slice(0, 8)]).toEqual([0x23, 0x01, 0x07, 0x0f, 0x00, 0x05, 0x00, 0x18]);
  });

  it('supports every documented image-transfer resolution including fragment 255', () => {
    for (const mode of Object.values(IR_RESOLUTION_MODES)) {
      const payload = buildIrModeConfig(mode.fragmentCount);
      expect(payload[3]).toBe(mode.fragmentCount - 1);

      const assembler = new IrFrameAssembler(mode.width, mode.height, mode.fragmentCount);
      let frame: Uint8Array | null = null;
      for (let index = 0; index < mode.fragmentCount; index += 1) {
        frame = assembler.accept({
          index,
          pixels: new Uint8Array(IR_FRAGMENT_BYTES).fill(index),
        }).frame;
      }
      expect(frame).toHaveLength(mode.width * mode.height);
      expect(frame?.at(-1)).toBe((mode.fragmentCount - 1) & 0xff);
    }
  });

  it('encodes exposure, gain, LED modes, flip, filtering, and denoise registers', () => {
    const settings = {
      ...DEFAULT_IR_SETTINGS,
      resolution: '320x240' as const,
      exposureMicroseconds: 600,
      digitalGain: 20,
      farLedEnabled: false,
      nearLedEnabled: true,
      flashlight: false,
      strobe: true,
      horizontalFlip: true,
      denoiseEnabled: false,
      denoiseEdgeSmoothing: 12,
      denoiseColorInterpolation: 34,
    };
    const first = decodeRegisters(buildIrRegisterConfig(1, settings));
    const second = decodeRegisters(buildIrRegisterConfig(2, settings));

    expect(first.get(0x2e00)).toBe(0x00);
    expect(first.get(0x3001)).toBe(0x20);
    expect(first.get(0x3101)).toBe(0x49);
    expect(first.get(0x1000)).toBe(0x90);
    expect(first.get(0x2e01)).toBe(0x40);
    expect(first.get(0x2f01)).toBe(0x01);
    expect(first.get(0x0e00)).toBe(0x03);
    expect(second.get(0x2d00)).toBe(0x02);
    expect(second.get(0x6701)).toBe(0x00);
    expect(second.get(0x6801)).toBe(12);
    expect(second.get(0x6901)).toBe(34);
  });

  it('builds a resend request that names the next expected fragment', () => {
    const resend = buildIrFragmentPoll(4, true);
    expect(resend[1]).toBe(0x01);
    expect(resend[2]).toBe(4);
    expect(resend[3]).toBe(0);
  });
});

function decodeRegisters(payload: Uint8Array) {
  const registers = new Map<number, number>();
  for (let index = 0; index < payload[2]; index += 1) {
    const offset = 3 + index * 3;
    registers.set(payload[offset] | (payload[offset + 1] << 8), payload[offset + 2]);
  }
  return registers;
}
