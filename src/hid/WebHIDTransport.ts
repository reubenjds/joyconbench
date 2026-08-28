import {
  NINTENDO_VENDOR_ID,
  SUPPORTED_PRODUCT_IDS,
  controllerKindFromProductId,
  type ConnectionKind,
} from '../types/controller';
import {
  INPUT_REPORT_SUBCOMMAND_REPLY,
  OUTPUT_REPORT_RUMBLE,
  OUTPUT_REPORT_MCU,
  OUTPUT_REPORT_SUBCOMMAND,
  MAX_SPI_TRANSFER_BYTES,
  SUBCOMMAND_SPI_READ,
  SUBCOMMAND_SPI_WRITE,
  buildRumblePacket,
  buildMcuPacket,
  buildSubcommandPacket,
} from '../protocol/nintendo';
import { isDocumentedSettingsRange } from '../protocol/settings';

type InputListener = (event: HIDInputReportEvent) => void;

export class WebHIDTransport {
  private currentDevice: HIDDevice | null = null;
  private counter = 0;
  private readonly listeners = new Set<InputListener>();
  private pendingReply: {
    subcommand: number;
    resolve: (reply: Uint8Array) => void;
    reject: (error: Error) => void;
    timeout: number;
  } | null = null;
  private replyQueue: Promise<void> = Promise.resolve();

  get device() {
    return this.currentDevice;
  }

  static isSupported() {
    return window.isSecureContext && Boolean(navigator.hid);
  }

  async requestDevice() {
    if (!navigator.hid) throw new Error('WebHID is unavailable in this browser.');
    const devices = await navigator.hid.requestDevice({
      filters: SUPPORTED_PRODUCT_IDS.map((productId) => ({
        vendorId: NINTENDO_VENDOR_ID,
        productId,
      })),
    });
    const device = devices[0];
    if (!device) throw new Error('No controller was selected.');
    return device;
  }

  async open(device?: HIDDevice) {
    const selected = device ?? (await this.requestDevice());
    if (
      selected.vendorId !== NINTENDO_VENDOR_ID ||
      controllerKindFromProductId(selected.productId) === null
    ) {
      throw new Error('This controller is not supported by JoyConBench v1.');
    }
    if (this.currentDevice && this.currentDevice !== selected) await this.close();
    this.currentDevice = selected;
    if (!selected.opened) await selected.open();
    selected.removeEventListener('inputreport', this.handleInputReport);
    selected.addEventListener('inputreport', this.handleInputReport);
    return selected;
  }

  async close() {
    if (!this.currentDevice) return;
    const device = this.currentDevice;
    device.removeEventListener('inputreport', this.handleInputReport);
    this.currentDevice = null;
    if (this.pendingReply) {
      window.clearTimeout(this.pendingReply.timeout);
      this.pendingReply.reject(new Error('Controller disconnected during a settings command.'));
      this.pendingReply = null;
    }
    if (device.opened) await device.close();
  }

  connectionKind(): ConnectionKind {
    if (!this.currentDevice) return 'unknown';
    return 'bluetooth';
  }

  async sendSubcommand(subcommand: number, payload: number[] = []) {
    if (!this.currentDevice) throw new Error('No controller is connected.');
    const packet = buildSubcommandPacket(this.nextCounter(), subcommand, payload);
    await this.currentDevice.sendReport(OUTPUT_REPORT_SUBCOMMAND, packet);
  }

  async transactSubcommand(subcommand: number, payload: number[] = []) {
    return this.sendSubcommandAndWait(subcommand, payload);
  }

  async sendMcuCommand(subcommand: number, payload: Uint8Array) {
    if (!this.currentDevice) throw new Error('No controller is connected.');
    await this.currentDevice.sendReport(
      OUTPUT_REPORT_MCU,
      buildMcuPacket(this.nextCounter(), subcommand, payload)
    );
  }

  async readSpi(address: number, length: number) {
    if (!Number.isInteger(address) || address < 0 || address > 0xffffffff) {
      throw new Error('Invalid SPI address.');
    }
    if (!Number.isInteger(length) || length < 1 || length > MAX_SPI_TRANSFER_BYTES) {
      throw new Error(`SPI reads must contain 1–${MAX_SPI_TRANSFER_BYTES} bytes.`);
    }
    if (!isDocumentedSettingsRange(address, length)) {
      throw new Error('Blocked SPI read outside documented controller settings.');
    }
    const payload = [...uint32LittleEndian(address), length];
    const reply = await this.sendSubcommandAndWait(SUBCOMMAND_SPI_READ, payload);
    if (reply.length < 5 + length) throw new Error('The controller returned a short SPI reply.');
    const returnedAddress = readUint32LittleEndian(reply, 0);
    const returnedLength = reply[4];
    if (returnedAddress !== address || returnedLength !== length) {
      throw new Error('The controller returned a mismatched SPI reply.');
    }
    return reply.slice(5, 5 + length);
  }

  async writeSpi(address: number, data: Uint8Array) {
    if (!Number.isInteger(address) || address < 0 || address > 0xffffffff) {
      throw new Error('Invalid SPI address.');
    }
    if (data.length < 1 || data.length > MAX_SPI_TRANSFER_BYTES) {
      throw new Error(`SPI writes must contain 1–${MAX_SPI_TRANSFER_BYTES} bytes.`);
    }
    if (!isDocumentedSettingsRange(address, data.length)) {
      throw new Error('Blocked SPI write outside documented controller settings.');
    }
    const reply = await this.sendSubcommandAndWait(SUBCOMMAND_SPI_WRITE, [
      ...uint32LittleEndian(address),
      data.length,
      ...data,
    ]);
    if (reply[0] !== 0x00) throw new Error('The controller rejected the settings write.');
  }

  private sendSubcommandAndWait(subcommand: number, payload: number[]) {
    const operation = this.replyQueue.then(() =>
      this.performSubcommandAndWait(subcommand, payload)
    );
    this.replyQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async performSubcommandAndWait(subcommand: number, payload: number[]) {
    if (!this.currentDevice) throw new Error('No controller is connected.');
    const reply = new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (this.pendingReply?.subcommand !== subcommand) return;
        this.pendingReply = null;
        reject(new Error(`Controller settings command 0x${subcommand.toString(16)} timed out.`));
      }, 2000);
      this.pendingReply = { subcommand, resolve, reject, timeout };
    });
    try {
      await this.sendSubcommand(subcommand, payload);
    } catch (error) {
      if (this.pendingReply?.subcommand === subcommand) {
        window.clearTimeout(this.pendingReply.timeout);
        this.pendingReply = null;
      }
      throw error;
    }
    return reply;
  }

  async sendRumble(amplitude = 0.12) {
    if (!this.currentDevice) throw new Error('No controller is connected.');
    await this.currentDevice.sendReport(
      OUTPUT_REPORT_RUMBLE,
      buildRumblePacket(this.nextCounter(), amplitude)
    );
  }

  subscribe(listener: InputListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private nextCounter() {
    const current = this.counter;
    this.counter = (this.counter + 1) & 0x0f;
    return current;
  }

  private readonly handleInputReport = (event: HIDInputReportEvent) => {
    for (const listener of this.listeners) listener(event);
    if (event.reportId !== INPUT_REPORT_SUBCOMMAND_REPLY || !this.pendingReply) return;
    if (event.data.byteLength < 14) return;
    const ack = event.data.getUint8(12);
    const subcommand = event.data.getUint8(13);
    if (subcommand !== this.pendingReply.subcommand) return;
    const pending = this.pendingReply;
    this.pendingReply = null;
    window.clearTimeout(pending.timeout);
    if ((ack & 0x80) === 0) {
      pending.reject(new Error(`Controller rejected subcommand 0x${subcommand.toString(16)}.`));
      return;
    }
    pending.resolve(
      new Uint8Array(
        event.data.buffer.slice(
          event.data.byteOffset + 14,
          event.data.byteOffset + event.data.byteLength
        )
      )
    );
  };
}

function uint32LittleEndian(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}
