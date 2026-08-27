import type {
  ControllerColors,
  ControllerIdentity,
  ControllerSettingsBackup,
  ControllerSettingsSegment,
} from '../types/controller';
import {
  FACTORY_LEFT_STICK_REGION,
  FACTORY_MOTION_REGION,
  FACTORY_RIGHT_STICK_REGION,
  USER_MOTION_REGION,
  USER_STICK_REGION,
} from './calibration';

export const COLOR_USE_ADDRESS = 0x601b;
export const COLOR_ADDRESS = 0x6050;
export const COLOR_LENGTH = 6;
const BINARY_BACKUP_MAGIC = new TextEncoder().encode('JCBSET01');
const BINARY_BACKUP_HEADER_LENGTH = 20;
const BINARY_BACKUP_CHECKSUM_LENGTH = 32;

export const LEGACY_SETTINGS_REGIONS = [
  { name: 'color-use', address: 0x601b, length: 1 },
  FACTORY_MOTION_REGION,
  FACTORY_LEFT_STICK_REGION,
  FACTORY_RIGHT_STICK_REGION,
  { name: 'appearance', address: 0x6050, length: 12 },
  { name: 'sensor-stick-parameters', address: 0x6080, length: 42 },
] as const;

export const SETTINGS_REGIONS = [
  ...LEGACY_SETTINGS_REGIONS,
  USER_STICK_REGION,
  USER_MOTION_REGION,
] as const;

export const SETTINGS_BACKUP_BYTES = SETTINGS_REGIONS.reduce(
  (total, region) => total + region.length,
  0
);

export function isDocumentedSettingsRange(address: number, length: number) {
  return SETTINGS_REGIONS.some(
    (region) => address >= region.address && address + length <= region.address + region.length
  );
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex))
    throw new Error('Backup contains invalid hexadecimal data.');
  return new Uint8Array(hex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
}

export function colorsFromBytes(bytes: Uint8Array): ControllerColors {
  if (bytes.length < COLOR_LENGTH)
    throw new Error('The controller returned incomplete colour data.');
  return {
    body: `#${bytesToHex(bytes.slice(0, 3))}`,
    buttons: `#${bytesToHex(bytes.slice(3, 6))}`,
  };
}

export function colorsToBytes(colors: ControllerColors) {
  const body = colorToBytes(colors.body);
  const buttons = colorToBytes(colors.buttons);
  return new Uint8Array([...body, ...buttons]);
}

export async function buildSettingsBackup(
  identity: ControllerIdentity,
  segments: ControllerSettingsSegment[]
): Promise<ControllerSettingsBackup> {
  const backup = {
    format: 'joyconbench-controller-settings-v1' as const,
    createdAt: new Date().toISOString(),
    controller: { kind: identity.kind, productId: identity.productId },
    segments,
  };
  return {
    ...backup,
    checksum: { algorithm: 'SHA-256', hex: await sha256(canonicalBackup(backup)) },
  };
}

export async function validateSettingsBackup(
  value: unknown,
  identity?: ControllerIdentity
): Promise<ControllerSettingsBackup> {
  if (!value || typeof value !== 'object')
    throw new Error('This is not a JoyConBench settings backup.');
  const backup = value as Partial<ControllerSettingsBackup>;
  if (backup.format !== 'joyconbench-controller-settings-v1') {
    throw new Error('This settings backup format is not supported.');
  }
  if (!backup.controller || !backup.segments || !backup.checksum || !backup.createdAt) {
    throw new Error('This settings backup is incomplete.');
  }
  if (!Array.isArray(backup.segments)) {
    throw new Error('This backup does not contain the expected settings regions.');
  }
  const regions = regionsForSegments(backup.segments);
  if (!regions) throw new Error('This backup does not contain the expected settings regions.');
  for (const region of regions) {
    const matches = backup.segments.filter(
      (segment) => segment.name === region.name && segment.address === region.address
    );
    if (matches.length !== 1 || hexToBytes(matches[0].dataHex).length !== region.length) {
      throw new Error(`The ${region.name} settings region is invalid.`);
    }
  }
  if (identity) {
    if (
      backup.controller.kind !== identity.kind ||
      backup.controller.productId !== identity.productId
    ) {
      throw new Error('This backup belongs to a different controller type.');
    }
  }
  if (backup.checksum.algorithm !== 'SHA-256') throw new Error('Unsupported backup checksum.');
  const expected = await sha256(
    canonicalBackup({
      format: backup.format,
      createdAt: backup.createdAt,
      controller: backup.controller,
      segments: backup.segments,
    })
  );
  if (expected !== backup.checksum.hex.toLowerCase()) {
    throw new Error('The settings backup checksum does not match.');
  }
  return backup as ControllerSettingsBackup;
}

export async function encodeSettingsBackup(backup: ControllerSettingsBackup) {
  const validated = await validateSettingsBackup(backup);
  const payloadLength = validated.segments.reduce(
    (total, segment) => total + 6 + hexToBytes(segment.dataHex).length,
    0
  );
  const bytes = new Uint8Array(
    BINARY_BACKUP_HEADER_LENGTH + payloadLength + BINARY_BACKUP_CHECKSUM_LENGTH
  );
  const view = new DataView(bytes.buffer);
  const createdAt = Date.parse(validated.createdAt);
  if (!Number.isFinite(createdAt)) throw new Error('The backup timestamp is invalid.');

  bytes.set(BINARY_BACKUP_MAGIC, 0);
  view.setUint8(8, controllerKindCode(validated.controller.kind));
  view.setUint16(9, validated.controller.productId, true);
  view.setFloat64(11, createdAt, true);
  view.setUint8(19, validated.segments.length);

  let cursor = BINARY_BACKUP_HEADER_LENGTH;
  for (const segment of validated.segments) {
    const data = hexToBytes(segment.dataHex);
    view.setUint32(cursor, segment.address, true);
    view.setUint16(cursor + 4, data.length, true);
    bytes.set(data, cursor + 6);
    cursor += 6 + data.length;
  }
  bytes.set(hexToBytes(validated.checksum.hex), cursor);
  return bytes;
}

export function isBinarySettingsBackup(value: Uint8Array) {
  return BINARY_BACKUP_MAGIC.every((byte, index) => value[index] === byte);
}

export async function decodeSettingsBackup(
  value: ArrayBuffer | Uint8Array,
  identity?: ControllerIdentity
) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (
    bytes.length < BINARY_BACKUP_HEADER_LENGTH + BINARY_BACKUP_CHECKSUM_LENGTH ||
    !isBinarySettingsBackup(bytes)
  ) {
    throw new Error('This is not a JoyConBench binary settings backup.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = controllerKindFromCode(view.getUint8(8));
  const productId = view.getUint16(9, true);
  const timestamp = view.getFloat64(11, true);
  const regionCount = view.getUint8(19);
  if (!kind || !Number.isFinite(timestamp)) throw new Error('The binary backup header is invalid.');
  const regions = regionsForCount(regionCount);
  if (!regions) {
    throw new Error('This binary backup does not contain the expected settings regions.');
  }

  let cursor = BINARY_BACKUP_HEADER_LENGTH;
  const segments: ControllerSettingsSegment[] = [];
  for (const region of regions) {
    if (cursor + 6 > bytes.length - BINARY_BACKUP_CHECKSUM_LENGTH) {
      throw new Error('The binary backup is incomplete.');
    }
    const address = view.getUint32(cursor, true);
    const length = view.getUint16(cursor + 4, true);
    if (address !== region.address || length !== region.length) {
      throw new Error(`The ${region.name} binary settings region is invalid.`);
    }
    cursor += 6;
    if (cursor + length > bytes.length - BINARY_BACKUP_CHECKSUM_LENGTH) {
      throw new Error('The binary backup is incomplete.');
    }
    segments.push({
      name: region.name,
      address,
      dataHex: bytesToHex(bytes.slice(cursor, cursor + length)),
    });
    cursor += length;
  }
  if (cursor + BINARY_BACKUP_CHECKSUM_LENGTH !== bytes.length) {
    throw new Error('The binary backup has unexpected trailing data.');
  }

  return validateSettingsBackup(
    {
      format: 'joyconbench-controller-settings-v1',
      createdAt: new Date(timestamp).toISOString(),
      controller: { kind, productId },
      segments,
      checksum: {
        algorithm: 'SHA-256',
        hex: bytesToHex(bytes.slice(cursor)),
      },
    },
    identity
  );
}

function colorToBytes(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('Controller colours must use six-digit hex values.');
  return hexToBytes(color.slice(1));
}

function canonicalBackup(value: Omit<ControllerSettingsBackup, 'checksum'>) {
  return JSON.stringify({
    format: value.format,
    createdAt: value.createdAt,
    controller: value.controller,
    segments: value.segments.map(({ name, address, dataHex }) => ({ name, address, dataHex })),
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function controllerKindCode(kind: ControllerIdentity['kind']) {
  if (kind === 'joycon-left') return 1;
  if (kind === 'joycon-right') return 2;
  return 3;
}

function controllerKindFromCode(code: number): ControllerIdentity['kind'] | null {
  if (code === 1) return 'joycon-left';
  if (code === 2) return 'joycon-right';
  return null;
}

function regionsForCount(count: number) {
  if (count === SETTINGS_REGIONS.length) return SETTINGS_REGIONS;
  if (count === LEGACY_SETTINGS_REGIONS.length) return LEGACY_SETTINGS_REGIONS;
  return null;
}

function regionsForSegments(segments: ControllerSettingsSegment[]) {
  const regions = regionsForCount(segments.length);
  if (!regions) return null;
  const valid = regions.every(
    (region) =>
      segments.filter(
        (segment) => segment.name === region.name && segment.address === region.address
      ).length === 1
  );
  return valid ? regions : null;
}
