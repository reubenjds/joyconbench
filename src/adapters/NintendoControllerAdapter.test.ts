import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import { NintendoControllerAdapter } from './NintendoControllerAdapter';

function packStickValues(values: [number, number, number, number, number, number]) {
  const packed = new Uint8Array(9);
  for (let index = 0; index < values.length; index += 2) {
    const offset = (index / 2) * 3;
    packed[offset] = values[index] & 0xff;
    packed[offset + 1] = ((values[index] >> 8) & 0x0f) | ((values[index + 1] & 0x0f) << 4);
    packed[offset + 2] = (values[index + 1] >> 4) & 0xff;
  }
  return packed;
}

function setStick(bytes: Uint8Array, offset: number, x: number, y: number) {
  bytes[offset] = x & 0xff;
  bytes[offset + 1] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4);
  bytes[offset + 2] = (y >> 4) & 0xff;
}

function packImu(values: number[]) {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

const device = {
  vendorId: 0x057e,
  productId: 0x2006,
  productName: 'Joy-Con (L)',
  opened: true,
  collections: [],
} as unknown as HIDDevice;

class SilentTransport {
  async open() {
    return device;
  }
  async close() {}
  connectionKind() {
    return 'bluetooth' as const;
  }
  async sendSubcommand() {}
  async sendRumble() {}
  subscribe() {
    return () => undefined;
  }
}

describe('NintendoControllerAdapter initialization', () => {
  afterEach(() => vi.useRealTimers());

  it('times out when standard input reports never arrive', async () => {
    vi.useFakeTimers();
    const adapter = new NintendoControllerAdapter(
      new SilentTransport() as unknown as WebHIDTransport
    );
    await adapter.connect(device);
    const initializing = adapter.initialize();
    const rejection = expect(initializing).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it('loads active stick and IMU calibration before initialization completes', async () => {
    const report = new Uint8Array(48);
    setStick(report, 5, 2100, 2000);
    new DataView(report.buffer).setInt16(18, 100, true);
    let reportListener: (event: { reportId: number; data: DataView }) => void = () => undefined;
    const transport = {
      async open() {
        return device;
      },
      async close() {},
      connectionKind() {
        return 'bluetooth' as const;
      },
      subscribe(listener: typeof reportListener) {
        reportListener = listener;
        return () => undefined;
      },
      async sendSubcommand(subcommand: number) {
        if (subcommand === 0x03) {
          reportListener({ reportId: 0x30, data: new DataView(report.buffer) });
        }
      },
      async readSpi(address: number, length: number) {
        if (address === 0x603d) {
          return packStickValues([1000, 900, 2100, 2000, 800, 700]).slice(0, length);
        }
        if (address === 0x6020) {
          return packImu([0, 0, 0, 16384, 16384, 16384, 100, 0, 0, 13471, 13371, 13371]).slice(
            0,
            length
          );
        }
        if (address === 0x8010) return new Uint8Array(length).fill(0xff);
        if (address === 0x8026) return new Uint8Array(length).fill(0xff);
        return new Uint8Array(length);
      },
      async sendRumble() {},
    };
    const adapter = new NintendoControllerAdapter(transport as unknown as WebHIDTransport);
    const samples: Array<{
      sticks: { left?: { x: number; y: number } };
      imuFrames: ArrayLike<{ gyroscope: { x: number } }>;
      calibration: { imu: string };
    }> = [];
    adapter.subscribe((sample) => samples.push(sample));

    await adapter.connect(device);
    await adapter.initialize();
    reportListener({ reportId: 0x30, data: new DataView(report.buffer) });

    expect(samples.at(-1)?.sticks.left).toEqual({ x: 0, y: 0 });
    expect(samples.at(-1)?.imuFrames[0].gyroscope.x).toBe(0);
    expect(samples.at(-1)?.calibration.imu).toBe('factory');
  });
});
