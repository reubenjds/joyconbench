import { describe, expect, it } from 'vitest';
import type { ControllerIdentity } from '../types/controller';
import {
  SETTINGS_REGIONS,
  buildSettingsBackup,
  bytesToHex,
  colorsFromBytes,
  colorsToBytes,
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

  it('accepts an intact scoped backup for the matching controller', async () => {
    const segments = SETTINGS_REGIONS.map((region, index) => ({
      name: region.name,
      address: region.address,
      dataHex: '00'.repeat(region.length - 1) + index.toString(16).padStart(2, '0'),
    }));
    const backup = await buildSettingsBackup(identity, segments);
    await expect(validateSettingsBackup(backup, identity)).resolves.toEqual(backup);
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
