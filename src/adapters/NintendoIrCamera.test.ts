import { describe, expect, it, vi } from 'vitest';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import {
  DEFAULT_IR_SETTINGS,
  IR_FRAGMENT_BYTES,
  IR_FRAGMENT_COUNT,
  IR_PIXELS_OFFSET,
  calculateMcuCrc,
} from '../protocol/ir';
import type { ControllerKind } from '../types/controller';
import { NintendoIrCamera } from './NintendoIrCamera';

const FAST_TIMINGS = {
  configAttempts: 4,
  configTimeoutMs: 40,
  stateAttempts: 4,
  stateTimeoutMs: 20,
  subcommandAttempts: 2,
};

/**
 * A deliberately strict right Joy-Con. It refuses every step the way CTCaer's jc_toolkit trace
 * shows the real microcontroller does: configuration is ordered, payload CRCs are checked, and a
 * fragment is only released once the previous one is acknowledged by its own number.
 */
class ProtocolIrDevice extends EventTarget {
  opened = true;
  vendorId = 0x057e;
  productId = 0x2007;
  productName = 'Joy-Con (R)';
  collections = [];

  inputReportMode = 0x3f;
  mcuMode = 0x00;
  irMode = 0x00;
  registerGroups = 0;
  lastSentFragment: number | null = null;
  /** Status polls answered with "initializing" before the MCU settles in standby. */
  bootPolls = 2;
  emptyReportsBeforeFragment = 0;
  fragmentCount = IR_FRAGMENT_COUNT;

  async open() {}
  async close() {
    this.opened = false;
  }

  async sendReport(reportId: number, packet: Uint8Array) {
    const command = packet[9];
    const payload = packet.slice(10);
    if (reportId === 0x01) return this.handleSubcommand(command, payload);
    if (reportId === 0x11) return this.handleMcuCommand(command, payload);
  }

  private handleSubcommand(subcommand: number, payload: Uint8Array) {
    if (subcommand === 0x03) {
      this.inputReportMode = payload[0];
      this.replySubcommand(subcommand, new Uint8Array(1));
      return;
    }
    if (subcommand === 0x22) {
      this.mcuMode = payload[0] === 0x01 ? 0x06 : 0x00;
      this.irMode = 0x00;
      this.registerGroups = 0;
      this.replySubcommand(subcommand, new Uint8Array(1));
      return;
    }
    if (subcommand !== 0x21) return;
    if (payload.length !== 38) return;
    if (payload[37] !== calculateMcuCrc(payload.slice(1, 37))) return;

    // 0x21 0x00: set MCU mode. Rejected until the MCU has finished booting.
    if (payload[0] === 0x21 && payload[1] === 0x00) {
      if (this.mcuMode !== 0x01) return;
      const reply = new Uint8Array(38);
      reply[0] = 0x01;
      reply[7] = 0x01; // The MCU reports the mode it is leaving, not the requested one.
      this.mcuMode = payload[2];
      this.replySubcommand(0x21, reply);
      return;
    }
    // 0x23 0x01: pick the IR mode and fragment count.
    if (payload[0] === 0x23 && payload[1] === 0x01) {
      if (this.mcuMode !== 0x05) return;
      this.fragmentCount = payload[3] + 1;
      this.irMode = payload[2];
      this.replySubcommand(0x21, new Uint8Array([0x0b]));
      return;
    }
    // 0x23 0x04: write sensor registers.
    if (payload[0] === 0x23 && payload[1] === 0x04) {
      if (this.irMode !== 0x07) return;
      this.registerGroups += 1;
      this.replySubcommand(0x21, new Uint8Array([0x23]));
      return;
    }
  }

  private handleMcuCommand(command: number, payload: Uint8Array) {
    if (command === 0x01) {
      if (this.mcuMode === 0x06 && this.bootPolls > 0) this.bootPolls -= 1;
      if (this.mcuMode === 0x06 && this.bootPolls === 0) this.mcuMode = 0x01;
      const state = new Uint8Array(64);
      state[48] = 0x01;
      state[55] = this.mcuMode;
      this.emit(0x31, state);
      return;
    }
    if (command !== 0x03) return;
    if (payload[36] !== calculateMcuCrc(payload.slice(0, 36))) return;
    if (payload[37] !== 0xff) return;

    if (payload[0] === 0x02) {
      // Report the active IR mode, which is how the first register group is confirmed.
      this.replySubcommand(0x21, new Uint8Array([0x13, 0x00, this.irMode]));
      return;
    }
    if (this.registerGroups < 2) return;

    if (payload[1] === 0x01) {
      this.sendFragment(payload[2]);
      return;
    }
    const acknowledged = payload[3];
    if (this.lastSentFragment === null) {
      this.sendFragment(0);
      return;
    }
    // A wrong acknowledgement stalls the real MCU, so ignore it here too.
    if (acknowledged !== this.lastSentFragment) return;
    this.sendFragment((acknowledged + 1) % this.fragmentCount);
  }

  private sendFragment(index: number) {
    if (this.emptyReportsBeforeFragment > 0) {
      this.emptyReportsBeforeFragment -= 1;
      const empty = new Uint8Array(64);
      empty[48] = 0xff;
      this.emit(0x31, empty);
      return;
    }
    this.lastSentFragment = index;
    const report = new Uint8Array(IR_PIXELS_OFFSET + IR_FRAGMENT_BYTES);
    report[48] = 0x03;
    report[51] = index;
    report.fill(index, IR_PIXELS_OFFSET);
    this.emit(0x31, report);
  }

  private replySubcommand(subcommand: number, reply: Uint8Array) {
    const report = new Uint8Array(64);
    report[12] = 0x80;
    report[13] = subcommand;
    report.set(reply.slice(0, report.length - 14), 14);
    this.emit(0x21, report);
  }

  private emit(reportId: number, data: Uint8Array) {
    const event = new Event('inputreport');
    Object.defineProperties(event, {
      reportId: { value: reportId },
      data: { value: new DataView(data.buffer) },
      device: { value: this },
    });
    // A macrotask keeps the simulated exchange from starving the event loop.
    setTimeout(() => this.dispatchEvent(event), 0);
  }
}

async function connect(device: ProtocolIrDevice, kind: ControllerKind = 'joycon-right') {
  const transport = new WebHIDTransport();
  await transport.open(device as unknown as HIDDevice);
  return new NintendoIrCamera(transport, () => kind, FAST_TIMINGS);
}

function nextFrame(camera: NintendoIrCamera) {
  return new Promise<Uint8Array>((resolve) => {
    const unsubscribe = camera.subscribe((frame) => {
      unsubscribe();
      resolve(frame.pixels);
    });
  });
}

describe('Nintendo right Joy-Con IR camera', () => {
  it('rejects controllers without an IR camera', async () => {
    const device = new ProtocolIrDevice();
    const camera = await connect(device, 'joycon-left');

    await expect(camera.start()).rejects.toThrow(/right Joy-Con/i);
    expect(device.inputReportMode).toBe(0x3f);
  });

  it('completes the handshake in order and streams assembled frames', async () => {
    const device = new ProtocolIrDevice();
    const camera = await connect(device);
    const frame = nextFrame(camera);

    await camera.start();

    expect(device.inputReportMode).toBe(0x31);
    expect(device.mcuMode).toBe(0x05);
    expect(device.irMode).toBe(0x07);
    expect(device.registerGroups).toBe(2);

    const pixels = await frame;
    expect(pixels).toHaveLength(80 * 60);
    expect(pixels[0]).toBe(0);
    expect(pixels.at(-1)).toBe(IR_FRAGMENT_COUNT - 1);

    await camera.stop();
    expect(device.mcuMode).toBe(0x00);
    expect(device.inputReportMode).toBe(0x30);
  });

  it('waits for the microcontroller to leave its initializing state', async () => {
    const device = new ProtocolIrDevice();
    device.bootPolls = 3;
    const camera = await connect(device);

    await camera.start();

    expect(device.mcuMode).toBe(0x05);
    expect(camera.diagnostics().join('\n')).toContain('MCU standby: reported');
    await camera.stop();
  });

  it('starts even when the controller never reports its MCU mode', async () => {
    const device = new ProtocolIrDevice();
    device.bootPolls = 0;
    device.mcuMode = 0x00;
    // Answer nothing to state polls while still accepting configuration writes.
    const originalSend = device.sendReport.bind(device);
    device.sendReport = async (reportId: number, packet: Uint8Array) => {
      if (reportId === 0x11 && packet[9] === 0x01) {
        device.mcuMode = device.mcuMode === 0x06 ? 0x01 : device.mcuMode;
        return;
      }
      return originalSend(reportId, packet);
    };
    const camera = await connect(device);

    await camera.start();

    expect(device.irMode).toBe(0x07);
    expect(camera.diagnostics().join('\n')).toContain('never reported, continuing anyway');
    await camera.stop();
  });

  it('keeps the stream alive when the microcontroller sends empty reports', async () => {
    const device = new ProtocolIrDevice();
    device.emptyReportsBeforeFragment = 3;
    const camera = await connect(device);
    const frame = nextFrame(camera);

    await camera.start();

    await expect(frame).resolves.toHaveLength(80 * 60);
    await camera.stop();
  });

  it('streams a complete frame at another sensor resolution', async () => {
    const device = new ProtocolIrDevice();
    const camera = await connect(device);
    const frame = nextFrame(camera);

    await camera.start({ ...DEFAULT_IR_SETTINGS, resolution: '40x30' });

    await expect(frame).resolves.toHaveLength(40 * 30);
    expect(device.fragmentCount).toBe(4);
    await camera.stop();
  });

  it('reports the failing stage when configuration is never confirmed', async () => {
    const device = new ProtocolIrDevice();
    const originalSend = device.sendReport.bind(device);
    device.sendReport = async (reportId: number, packet: Uint8Array) => {
      // Drop the IR mode selection so the handshake stalls at a known stage.
      if (reportId === 0x01 && packet[9] === 0x21 && packet[10] === 0x23 && packet[11] === 0x01) {
        return;
      }
      return originalSend(reportId, packet);
    };
    const camera = await connect(device);

    await expect(camera.start()).rejects.toThrow(/IR image transfer/);
    expect(camera.diagnostics().join('\n')).toContain('IR image transfer: attempt 1 unanswered');
    expect(device.inputReportMode).toBe(0x30);
  });

  it('does not stream before the sensor registers are written', async () => {
    const device = new ProtocolIrDevice();
    const camera = await connect(device);
    const listener = vi.fn();
    camera.subscribe(listener);

    device.registerGroups = 0;
    await device.sendReport(
      0x11,
      new Uint8Array([0, ...new Uint8Array(8), 0x03, ...new Uint8Array(38)])
    );

    expect(listener).not.toHaveBeenCalled();
    expect(device.lastSentFragment).toBeNull();
  });
});
