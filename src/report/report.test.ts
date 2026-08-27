import { describe, expect, it } from 'vitest';
import { buildReport, reportSummary } from './report';

describe('privacy-safe reports', () => {
  it('excludes device IDs and raw data by default', () => {
    const report = buildReport(
      {
        kind: 'joycon-left',
        displayName: 'Left Joy-Con',
        vendorId: 0x057e,
        productId: 0x2006,
        connection: 'bluetooth',
      },
      [],
      false,
      new Date('2026-08-24T12:00:00Z')
    );
    const json = JSON.stringify(report);
    expect(report.controller.vendorId).toBeUndefined();
    expect(report.controller.productId).toBeUndefined();
    expect(json).not.toMatch(/serial|macAddress/i);
    expect(json).not.toContain('"samples"');
    expect(report.privacy.identifyingValuesIncluded).toBe(false);
    expect(report.schemaVersion).toBe(2);
    expect(reportSummary(report)).toContain('No raw controller data is included');
  });
});
