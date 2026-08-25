import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import { NintendoControllerAdapter } from './NintendoControllerAdapter';

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
  async initializeUsbIfNeeded() {}
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
});
