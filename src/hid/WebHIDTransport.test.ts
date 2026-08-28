import { describe, expect, it } from 'vitest';
import { SUPPORTED_PRODUCT_IDS } from '../types/controller';
import { WebHIDTransport } from './WebHIDTransport';

class SpiDevice extends EventTarget {
  opened = true;
  vendorId = 0x057e;
  productId = 0x2006;
  productName = 'Joy-Con (L)';
  collections = [];
  sentReports: Array<{ reportId: number; packet: Uint8Array }> = [];

  async open() {}
  async close() {}
  async sendReport(reportId: number, packet: Uint8Array) {
    this.sentReports.push({ reportId, packet: packet.slice() });
    if (reportId !== 0x01) return;
    const subcommand = packet[9];
    const reply = new Uint8Array(50);
    reply[12] = subcommand === 0x10 ? 0x90 : 0x80;
    reply[13] = subcommand;
    if (subcommand === 0x10) {
      reply.set(packet.slice(10, 14), 14);
      reply[18] = packet[14];
      for (let index = 0; index < packet[14]; index += 1) reply[19 + index] = index + 1;
    } else {
      reply[14] = 0;
    }
    queueMicrotask(() => {
      const event = new Event('inputreport');
      Object.defineProperties(event, {
        reportId: { value: 0x21 },
        data: { value: new DataView(reply.buffer) },
        device: { value: this },
      });
      this.dispatchEvent(event);
    });
  }
}

describe('WebHID settings transactions', () => {
  it('limits v1 discovery to left and right Joy-Con', async () => {
    expect(SUPPORTED_PRODUCT_IDS).toEqual([0x2006, 0x2007]);

    const unsupported = new SpiDevice();
    unsupported.productId = 0x2009;
    await expect(new WebHIDTransport().open(unsupported as unknown as HIDDevice)).rejects.toThrow(
      /not supported/i
    );
  });

  it('matches acknowledged SPI reads and writes', async () => {
    const transport = new WebHIDTransport();
    const device = new SpiDevice();
    await transport.open(device as unknown as HIDDevice);
    await expect(transport.readSpi(0x6050, 6)).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    await expect(transport.writeSpi(0x6050, new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    await expect(transport.readSpi(0x8010, 22)).resolves.toHaveLength(22);
    await expect(transport.writeSpi(0x8026, new Uint8Array(26))).resolves.toBeUndefined();
  });

  it('rejects oversized transfers before sending them', async () => {
    const transport = new WebHIDTransport();
    await transport.open(new SpiDevice() as unknown as HIDDevice);
    await expect(transport.readSpi(0x6050, 30)).rejects.toThrow(/1–29/);
    await expect(transport.writeSpi(0x6050, new Uint8Array(30))).rejects.toThrow(/1–29/);
    await expect(transport.readSpi(0x6000, 1)).rejects.toThrow(/outside documented/i);
    await expect(transport.writeSpi(0x7000, new Uint8Array([1]))).rejects.toThrow(
      /outside documented/i
    );
  });

  it('clears the selected device even when the browser close call fails', async () => {
    const transport = new WebHIDTransport();
    const device = new SpiDevice();
    device.close = async () => {
      throw new Error('Bluetooth close failed.');
    };
    await transport.open(device as unknown as HIDDevice);

    await expect(transport.close()).rejects.toThrow(/close failed/i);

    expect(transport.device).toBeNull();
  });

  it('allows only the bounded MCU status and IR polling commands', async () => {
    const transport = new WebHIDTransport();
    const device = new SpiDevice();
    await transport.open(device as unknown as HIDDevice);

    await transport.sendMcuCommand(0x01, new Uint8Array(38));
    await transport.sendMcuCommand(0x03, new Uint8Array(38));

    expect(
      device.sentReports.slice(-2).map(({ reportId, packet }) => [reportId, packet[9]])
    ).toEqual([
      [0x11, 0x01],
      [0x11, 0x03],
    ]);
    await expect(transport.sendMcuCommand(0x02, new Uint8Array(38))).rejects.toThrow(
      /unsupported MCU command/i
    );
  });
});
