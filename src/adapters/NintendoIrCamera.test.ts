import { describe, expect, it, vi } from 'vitest';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import { IR_FRAGMENT_BYTES, IR_PIXELS_OFFSET } from '../protocol/ir';
import { NintendoIrCamera } from './NintendoIrCamera';

class ProtocolIrDevice extends EventTarget {
  opened = true;
  vendorId = 0x057e;
  productId = 0x2007;
  productName = 'Joy-Con (R)';
  collections = [];
  private mcuMode = 0x01;

  async open() {}
  async close() {
    this.opened = false;
  }

  async sendReport(reportId: number, packet: Uint8Array) {
    if (reportId === 0x01) {
      const subcommand = packet[9];
      const payload = packet.slice(10);
      if (subcommand === 0x21 && payload[0] === 0x21) this.mcuMode = 0x05;
      if (subcommand === 0x22 && payload[0] === 0x01) this.mcuMode = 0x01;
      const reply = new Uint8Array(64);
      reply[12] = 0x80;
      reply[13] = subcommand;
      if (subcommand === 0x21 && payload[0] === 0x23 && payload[1] === 0x01) {
        reply[14] = 0x0b;
      }
      if (subcommand === 0x21 && payload[0] === 0x23 && payload[1] === 0x04) {
        reply[14] = 0x23;
      }
      if (subcommand === 0x21 && payload[0] === 0x21) {
        reply[14] = 0x01;
        reply[21] = this.mcuMode;
      }
      queueMicrotask(() => this.emitReport(0x21, reply));
      return;
    }
    if (reportId !== 0x11) return;
    if (packet[9] === 0x01) {
      const state = new Uint8Array(64);
      state[48] = 0x01;
      state[55] = this.mcuMode;
      queueMicrotask(() => this.emitReport(0x31, state));
      return;
    }
    const payload = packet.slice(10);
    if (packet[9] !== 0x03 || payload[0] === 0x02) return;
    const fragment = payload[1] === 0x01 ? payload[2] : payload[3];
    const frame = new Uint8Array(IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES);
    frame[48] = 0x03;
    frame[51] = fragment;
    frame.fill(fragment, IR_PIXELS_OFFSET);
    queueMicrotask(() => this.emitReport(0x31, frame));
  }

  private emitReport(reportId: number, data: Uint8Array) {
    const event = new Event('inputreport');
    Object.defineProperties(event, {
      reportId: { value: reportId },
      data: { value: new DataView(data.buffer) },
      device: { value: this },
    });
    this.dispatchEvent(event);
  }
}

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
    if (subcommand === 0x21 && payload[0] === 0x21) {
      this.mcuMode = 0x05;
      const reply = new Uint8Array(8);
      reply[0] = 0x01;
      reply[7] = this.mcuMode;
      return reply;
    }
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

  it('completes startup and a frame through the real WebHID transport', async () => {
    const transport = new WebHIDTransport();
    await transport.open(new ProtocolIrDevice() as unknown as HIDDevice);
    const camera = new NintendoIrCamera(transport, () => 'joycon-right');
    const frameReceived = new Promise<Uint8Array>((resolve) => {
      camera.subscribe((frame) => resolve(frame.pixels));
    });

    await camera.start();
    await expect(frameReceived).resolves.toHaveLength(80 * 60);
    await camera.stop();
  });
});
