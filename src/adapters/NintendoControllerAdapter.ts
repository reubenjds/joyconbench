import { decodeStandardFullReport } from '../protocol/decoder';
import {
  INPUT_REPORT_STANDARD_FULL,
  SUBCOMMAND_ENABLE_IMU,
  SUBCOMMAND_ENABLE_VIBRATION,
  SUBCOMMAND_SET_INPUT_MODE,
  SUBCOMMAND_SET_PLAYER_LEDS,
} from '../protocol/nintendo';
import {
  NINTENDO_VENDOR_ID,
  controllerDisplayName,
  controllerKindFromProductId,
  type ControllerAdapter,
  type ControllerIdentity,
  type SampleListener,
} from '../types/controller';
import type {
  ControllerColors,
  ControllerSettingsBackup,
  SettingsProgress,
} from '../types/controller';
import { WebHIDTransport } from '../hid/WebHIDTransport';
import { MAX_SPI_TRANSFER_BYTES } from '../protocol/nintendo';
import {
  COLOR_ADDRESS,
  COLOR_LENGTH,
  COLOR_USE_ADDRESS,
  SETTINGS_REGIONS,
  buildSettingsBackup,
  bytesToHex,
  colorsFromBytes,
  colorsToBytes,
  hexToBytes,
  validateSettingsBackup,
} from '../protocol/settings';

export class NintendoControllerAdapter implements ControllerAdapter {
  private identity: ControllerIdentity | null = null;
  private readonly sampleListeners = new Set<SampleListener>();
  private unsubscribeTransport: (() => void) | null = null;

  constructor(private readonly transport = new WebHIDTransport()) {}

  async connect(device?: HIDDevice) {
    const opened = await this.transport.open(device);
    const kind = controllerKindFromProductId(opened.productId);
    if (!kind) throw new Error('Unsupported Nintendo controller.');
    this.identity = {
      kind,
      displayName: controllerDisplayName(kind),
      vendorId: NINTENDO_VENDOR_ID,
      productId: opened.productId,
      connection: this.transport.connectionKind(),
    };
    this.unsubscribeTransport = this.transport.subscribe((event) => {
      if (event.reportId !== INPUT_REPORT_STANDARD_FULL || !this.identity) return;
      try {
        const sample = decodeStandardFullReport(
          event.reportId,
          event.data,
          this.identity.kind,
          this.identity.connection
        );
        for (const listener of this.sampleListeners) listener(sample);
      } catch {
        // A malformed packet is ignored here and surfaced by packet-rate diagnostics as a gap.
      }
    });
    return this.identity;
  }

  async disconnect() {
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    await this.transport.close();
    this.identity = null;
  }

  async initialize() {
    const firstSample = this.createSampleWaiter(5000);
    try {
      await this.transport.initializeUsbIfNeeded();
      await this.enableInput();
      await this.enableImu();
      await this.transport.sendSubcommand(SUBCOMMAND_ENABLE_VIBRATION, [0x01]);
      await firstSample.promise;
    } catch (error) {
      firstSample.cancel();
      throw error;
    }
  }

  async identify() {
    if (!this.identity) throw new Error('No controller is connected.');
    return this.identity;
  }

  async enableInput() {
    await this.transport.sendSubcommand(SUBCOMMAND_SET_INPUT_MODE, [0x30]);
  }

  async enableImu() {
    await this.transport.sendSubcommand(SUBCOMMAND_ENABLE_IMU, [0x01]);
  }

  async rumble(durationMs = 300) {
    const duration = Math.min(Math.max(durationMs, 40), 300);
    await this.transport.sendRumble(0.12);
    await new Promise((resolve) => window.setTimeout(resolve, duration));
    await this.transport.sendRumble(0);
  }

  async setPlayerLeds(pattern: number) {
    await this.transport.sendSubcommand(SUBCOMMAND_SET_PLAYER_LEDS, [pattern & 0xff]);
  }

  async readColors() {
    return colorsFromBytes(await this.readRegion(COLOR_ADDRESS, COLOR_LENGTH));
  }

  async writeColors(colors: ControllerColors) {
    const data = colorsToBytes(colors);
    await this.writeRegion(COLOR_ADDRESS, data);
    await this.writeRegion(COLOR_USE_ADDRESS, new Uint8Array([0x01]));
    const verified = await this.readRegion(COLOR_ADDRESS, COLOR_LENGTH);
    if (bytesToHex(verified) !== bytesToHex(data)) {
      throw new Error('Colour verification failed; reconnect before trying again.');
    }
  }

  async backupSettings(onProgress?: SettingsProgress) {
    const identity = await this.identify();
    const segments = [];
    let completed = 0;
    const total = SETTINGS_REGIONS.reduce(
      (sum, region) => sum + Math.ceil(region.length / MAX_SPI_TRANSFER_BYTES),
      0
    );
    for (const region of SETTINGS_REGIONS) {
      const data = await this.readRegion(region.address, region.length, () => {
        completed += 1;
        onProgress?.(completed, total, `Reading ${region.name}`);
      });
      segments.push({ name: region.name, address: region.address, dataHex: bytesToHex(data) });
    }
    return buildSettingsBackup(identity, segments);
  }

  async restoreSettings(backup: ControllerSettingsBackup, onProgress?: SettingsProgress) {
    const identity = await this.identify();
    const validated = await validateSettingsBackup(backup, identity);
    const transfers = SETTINGS_REGIONS.reduce(
      (sum, region) => sum + Math.ceil(region.length / MAX_SPI_TRANSFER_BYTES),
      0
    );
    let completed = 0;
    const total = transfers * 2;
    for (const region of SETTINGS_REGIONS) {
      const segment = validated.segments.find((candidate) => candidate.name === region.name)!;
      const data = hexToBytes(segment.dataHex);
      await this.writeRegion(region.address, data, () => {
        completed += 1;
        onProgress?.(completed, total, `Restoring ${region.name}`);
      });
      const verified = await this.readRegion(region.address, region.length, () => {
        completed += 1;
        onProgress?.(completed, total, `Verifying ${region.name}`);
      });
      if (bytesToHex(verified) !== segment.dataHex.toLowerCase()) {
        throw new Error(`Verification failed for ${region.name}; stop and reconnect.`);
      }
    }
  }

  subscribe(listener: SampleListener) {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  private async readRegion(address: number, length: number, onChunk?: () => void) {
    const output = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += MAX_SPI_TRANSFER_BYTES) {
      const chunkLength = Math.min(MAX_SPI_TRANSFER_BYTES, length - offset);
      output.set(await this.transport.readSpi(address + offset, chunkLength), offset);
      onChunk?.();
    }
    return output;
  }

  private async writeRegion(address: number, data: Uint8Array, onChunk?: () => void) {
    for (let offset = 0; offset < data.length; offset += MAX_SPI_TRANSFER_BYTES) {
      const chunk = data.slice(offset, offset + MAX_SPI_TRANSFER_BYTES);
      await this.transport.writeSpi(address + offset, chunk);
      onChunk?.();
    }
  }

  private createSampleWaiter(timeoutMs: number) {
    let timeout = 0;
    let unsubscribe: () => void = () => undefined;
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
    };
    const promise = new Promise<void>((resolve, reject) => {
      unsubscribe = this.subscribe(() => {
        if (settled) return;
        cancel();
        resolve();
      });
      timeout = window.setTimeout(() => {
        if (settled) return;
        cancel();
        reject(new Error('Controller initialization timed out before input reports arrived.'));
      }, timeoutMs);
    });
    return { promise, cancel };
  }
}
