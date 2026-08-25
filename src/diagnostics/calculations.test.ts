import { describe, expect, it } from 'vitest';
import type { ControllerSample } from '../types/controller';
import { EMPTY_BUTTONS } from '../types/controller';
import {
  DEFAULT_THRESHOLDS,
  analyzeMotion,
  analyzeNeutral,
  analyzePackets,
  analyzeRange,
  analyzeStationaryImu,
} from './calculations';

function sample(index: number, x = 0, y = 0): ControllerSample {
  return {
    timestamp: index * (1000 / 60),
    buttons: { ...EMPTY_BUTTONS },
    sticks: { left: { x, y } },
    rawSticks: { left: { x: 2048 + x * 2047, y: 2048 + y * 2047 } },
    imuFrames: [0, 1, 2].map((frame) => ({
      offsetMs: frame * 5,
      accelerometer: { x: index / 10, y: index / 20, z: 1 },
      gyroscope: { x: index * 2, y: -index * 2, z: index },
    })) as unknown as ControllerSample['imuFrames'],
    battery: 'full',
    packetCounter: index & 0xff,
    connection: 'bluetooth',
  };
}

describe('diagnostic calculations', () => {
  it('keeps threshold-based neutral results inconclusive before validation', () => {
    const result = analyzeNeutral(
      Array.from({ length: 300 }, (_, index) => sample(index, 0.2, 0)),
      'left'
    );
    expect(DEFAULT_THRESHOLDS.validated).toBe(false);
    expect(result.status).toBe('inconclusive');
    expect(result.measurements.centerOffset).toBe(0.2);
  });

  it('measures full circular stick coverage', () => {
    const samples = Array.from({ length: 240 }, (_, index) => {
      const angle = (index / 240) * Math.PI * 2;
      return sample(index, Math.cos(angle), Math.sin(angle));
    });
    const result = analyzeRange(samples, 'left');
    expect(result.measurements.angularCoveragePercent).toBe(100);
    expect(result.measurements.minimumReach).toBeGreaterThan(0.95);
  });

  it('handles packet counter wrap without false drops', () => {
    const samples = Array.from({ length: 300 }, (_, index) => sample(index));
    const result = analyzePackets(samples);
    expect(result.measurements.counterDiscontinuities).toBe(0);
    expect(result.measurements.rateHz).toBeCloseTo(60, 1);
  });

  it('confirms all motion axes respond', () => {
    const result = analyzeMotion(Array.from({ length: 120 }, (_, index) => sample(index)));
    expect(result.measurements.responsiveAxes).toBe(3);
    expect(result.status).toBe('inconclusive');
  });

  it('measures real gyroscope bias and noise across all IMU frames', () => {
    const result = analyzeStationaryImu(Array.from({ length: 120 }, (_, index) => sample(index)));
    expect(result.measurements.frameCount).toBe(360);
    expect(result.measurements.gyroBiasDps).toBeGreaterThan(100);
    expect(result.measurements.gyroNoiseDps).toBeGreaterThan(50);
  });
});
