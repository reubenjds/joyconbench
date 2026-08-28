import { describe, expect, it, vi } from 'vitest';
import type { WebHIDTransport } from '../hid/WebHIDTransport';
import { IR_FRAGMENT_BYTES, IR_PIXELS_OFFSET } from '../protocol/ir';
import { NintendoIrCamera } from './NintendoIrCamera';

class FakeIrTransport {
  device = {} as HIDDevice;
  readonly transactions: Array<{ subcommand: number; payload: number[] }> = [];
  readonly mcuCommands: Array<{ subcommand: number; payload: Uint8Array }> = [];
  private listener: ((event: HIDInputReportEvent) => void) | null = null;
  private mcuMode = 0x01;

  subscribe(listener: (event: HIDInputReportEvent) => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  async transactSubcommand(subcommand: number, payload: number[]) {
    this.transactions.push({ subcommand, payload });
    if (subcommand === 0x21 && payload[0] === 0x21) this.mcuMode = 0x05;
    if (subcommand === 0x21 && payload[0] === 0x23 && payload[1] === 0x01) {
      return new Uint8Array([0x0b]);
    }
    if (subcommand === 0x21 && payload[0] === 0x23 && payload[1] === 0x04) {
      return new Uint8Array([0x23]);
    }
    return new Uint8Array();
  }

  async sendMcuCommand(subcommand: number, payload: Uint8Array) {
    this.mcuCommands.push({ subcommand, payload: payload.slice() });
    if (subcommand !== 0x01) return;
    const bytes = new Uint8Array(60);
    bytes[48] = 0x01;
    bytes[55] = this.mcuMode;
    this.emit(0x31, bytes);
  }

  emitFragment(index: number, value: number) {
    const bytes = new Uint8Array(IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES);
    bytes[48] = 0x03;
    bytes[51] = index;
    bytes.fill(value, IR_PIXELS_OFFSET);
    this.emit(0x31, bytes);
  }

  private emit(reportId: number, bytes: Uint8Array) {
    this.listener?.({ reportId, data: new DataView(bytes.buffer) } as HIDInputReportEvent);
  }
}

describe('Nintendo right Joy-Con IR camera', () => {
  it('rejects controllers without an IR camera', async () => {
    const transport = new FakeIrTransport();
    const camera = new NintendoIrCamera(
      transport as unknown as WebHIDTransport,
      () => 'joycon-left'
    );

    await expect(camera.start()).rejects.toThrow(/right Joy-Con/i);
    expect(transport.transactions).toHaveLength(0);
  });

  it('starts image transfer, emits complete frames, and restores standard input', async () => {
    const transport = new FakeIrTransport();
    const camera = new NintendoIrCamera(
      transport as unknown as WebHIDTransport,
      () => 'joycon-right'
    );
    const listener = vi.fn();
    camera.subscribe(listener);

    await camera.start();
    for (let index = 0; index < 16; index += 1) transport.emitFragment(index, index);

    expect(listener).toHaveBeenCalledTimes(1);
    const [frame, stats] = listener.mock.calls[0];
    expect(frame).toMatchObject({ width: 80, height: 60, sequence: 0 });
    expect(frame.pixels).toHaveLength(80 * 60);
    expect(stats).toMatchObject({ receivedPackets: 16, completedFrames: 1 });

    await camera.stop();
    expect(transport.transactions).toContainEqual({ subcommand: 0x22, payload: [0x00] });
    expect(transport.transactions).toContainEqual({ subcommand: 0x03, payload: [0x30] });
  });
});
