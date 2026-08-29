import { describe, expect, it } from 'vitest';
import {
  IR_FRAGMENT_BYTES,
  IR_FRAGMENT_COUNT,
  IR_PIXELS_OFFSET,
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

  it('builds a resend request that names the next expected fragment', () => {
    const resend = buildIrFragmentPoll(4, true);
    expect(resend[1]).toBe(0x01);
    expect(resend[2]).toBe(4);
    expect(resend[3]).toBe(0);
  });
});
