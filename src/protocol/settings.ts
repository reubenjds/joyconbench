import type {
  ControllerColors,
  ControllerIdentity,
  ControllerSettingsBackup,
  ControllerSettingsSegment,
} from '../types/controller';

export const COLOR_USE_ADDRESS = 0x601b;
export const COLOR_ADDRESS = 0x6050;
export const COLOR_LENGTH = 6;

export const SETTINGS_REGIONS = [
  { name: 'color-use', address: 0x601b, length: 1 },
  { name: 'factory-motion-calibration', address: 0x6020, length: 24 },
  { name: 'factory-left-stick-calibration', address: 0x603d, length: 9 },
  { name: 'factory-right-stick-calibration', address: 0x6046, length: 9 },
  { name: 'appearance', address: 0x6050, length: 12 },
  { name: 'sensor-stick-parameters', address: 0x6080, length: 42 },
] as const;

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
  if (!Array.isArray(backup.segments) || backup.segments.length !== SETTINGS_REGIONS.length) {
    throw new Error('This backup does not contain the expected settings regions.');
  }
  for (const region of SETTINGS_REGIONS) {
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
