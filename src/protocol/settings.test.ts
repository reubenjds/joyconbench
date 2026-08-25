import { describe, expect, it } from 'vitest';
import type { ControllerIdentity } from '../types/controller';
import {
  LEGACY_SETTINGS_REGIONS,
  SETTINGS_BACKUP_BYTES,
  SETTINGS_REGIONS,
  buildSettingsBackup,
  bytesToHex,
  colorsFromBytes,
  colorsToBytes,
  decodeSettingsBackup,
  encodeSettingsBackup,
  validateSettingsBackup,
} from './settings';

const identity: ControllerIdentity = {
  kind: 'joycon-left',
  displayName: 'Left Joy-Con',
  vendorId: 0x057e,
  productId: 0x2006,
  connection: 'bluetooth',
};

describe('controller settings safety', () => {
  it('round-trips body and button colours', () => {
    const bytes = colorsToBytes({ body: '#00aaff', buttons: '#221100' });
    expect(bytesToHex(bytes)).toBe('00aaff221100');
    expect(colorsFromBytes(bytes)).toEqual({ body: '#00aaff', buttons: '#221100' });
  });

  it('round-trips Pro Controller body, button, and independent grip colours', () => {
    const colors = {
      body: '#323232',
      buttons: '#ffffff',
      leftGrip: '#ff3278',
      rightGrip: '#1edc00',
    };
    const bytes = colorsToBytes(colors);

    expect(bytesToHex(bytes)).toBe('323232ffffffff32781edc00');
    expect(colorsFromBytes(bytes)).toEqual(colors);
  });

  it('accepts an intact scoped backup for the matching controller', async () => {
    const segments = SETTINGS_REGIONS.map((region, index) => ({
      name: region.name,
      address: region.address,
      dataHex: '00'.repeat(region.length - 1) + index.toString(16).padStart(2, '0'),
    }));
    const backup = await buildSettingsBackup(identity, segments);
    await expect(validateSettingsBackup(backup, identity)).resolves.toEqual(backup);
    expect(SETTINGS_BACKUP_BYTES).toBe(145);
    expect(backup.segments.map((segment) => segment.name)).toContain('user-stick-calibration');
    expect(backup.segments.map((segment) => segment.name)).toContain('user-motion-calibration');
  });

  it('continues to decode and validate legacy 97-byte settings backups', async () => {
    const segments = LEGACY_SETTINGS_REGIONS.map((region, index) => ({
      name: region.name,
      address: region.address,
      dataHex: index.toString(16).padStart(2, '0').repeat(region.length),
    }));
    const backup = await buildSettingsBackup(identity, segments);
    const encoded = await encodeSettingsBackup(backup);

    expect(segments.reduce((total, segment) => total + segment.dataHex.length / 2, 0)).toBe(97);
    await expect(decodeSettingsBackup(encoded, identity)).resolves.toEqual(backup);
  });

  it('round-trips the scoped backup through the compact binary format', async () => {
    const segments = SETTINGS_REGIONS.map((region, index) => ({
      name: region.name,
      address: region.address,
      dataHex: index.toString(16).padStart(2, '0').repeat(region.length),
    }));
    const backup = await buildSettingsBackup(identity, segments);
    const encoded = await encodeSettingsBackup(backup);

    expect(new TextDecoder().decode(encoded.slice(0, 8))).toBe('JCBSET01');
    expect(encoded.byteLength).toBeLessThan(256);
    await expect(decodeSettingsBackup(encoded, identity)).resolves.toEqual(backup);
  });

  it('rejects a modified binary backup', async () => {
    const segments = SETTINGS_REGIONS.map((region) => ({
      name: region.name,
      address: region.address,
      dataHex: '00'.repeat(region.length),
    }));
    const encoded = await encodeSettingsBackup(await buildSettingsBackup(identity, segments));
    encoded[26] ^= 0xff;

    await expect(decodeSettingsBackup(encoded, identity)).rejects.toThrow(/checksum/i);
  });

  it('rejects changed data and controller-type mismatches', async () => {
    const segments = SETTINGS_REGIONS.map((region) => ({
      name: region.name,
      address: region.address,
      dataHex: '00'.repeat(region.length),
    }));
    const backup = await buildSettingsBackup(identity, segments);
    const changed = structuredClone(backup);
    changed.segments[0].dataHex = '01';
    await expect(validateSettingsBackup(changed, identity)).rejects.toThrow(/checksum/i);
    await expect(
      validateSettingsBackup(backup, { ...identity, kind: 'joycon-right', productId: 0x2007 })
    ).rejects.toThrow(/different controller type/i);
  });
});
