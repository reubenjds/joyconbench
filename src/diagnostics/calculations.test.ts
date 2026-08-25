import { describe, expect, it } from 'vitest';
import type { ControllerSample } from '../types/controller';
import { EMPTY_BUTTONS } from '../types/controller';
import {
  DEFAULT_THRESHOLDS,
  analyzeMotion,
  analyzeNeutral,
  analyzePackets,
  analyzeRange,
  analyzeSnapback,
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
  it('classifies neutral drift using the research profile', () => {
    const result = analyzeNeutral(
      Array.from({ length: 300 }, (_, index) => sample(index, 0.2, 0)),
      'left'
    );
    expect(DEFAULT_THRESHOLDS.classification).toBe('research-based');
    expect(result.status).toBe('potential-issue');
    expect(result.measurements.centerOffset).toBe(0.2);
    expect(result.measurements.thresholdProfile).toBe('research-1');
  });

  it('still supports measurement-only profiles', () => {
    const result = analyzeNeutral(
      Array.from({ length: 300 }, (_, index) => sample(index, 0.2, 0)),
      'left',
      { ...DEFAULT_THRESHOLDS, classification: 'measurement-only' }
    );
    expect(result.status).toBe('inconclusive');
  });

  it('measures full circular stick coverage', () => {
    const samples = Array.from({ length: 240 }, (_, index) => {
      const angle = (index / 240) * Math.PI * 2;
      return sample(index, Math.cos(angle), Math.sin(angle));
    });
    const result = analyzeRange(samples, 'left');
    expect(result.status).toBe('pass');
    expect(result.measurements.angularCoveragePercent).toBe(100);
    expect(result.measurements.minimumReach).toBeGreaterThan(0.95);
  });

  it('handles packet counter wrap without false drops', () => {
    const samples = Array.from({ length: 300 }, (_, index) => sample(index));
    const result = analyzePackets(samples);
    expect(result.status).toBe('pass');
    expect(result.measurements.counterDiscontinuities).toBe(0);
    expect(result.measurements.rateHz).toBeCloseTo(60, 1);
  });

  it('confirms all motion axes respond', () => {
    const result = analyzeMotion(Array.from({ length: 120 }, (_, index) => sample(index)));
    expect(result.measurements.responsiveAxes).toBe(3);
    expect(result.status).toBe('pass');
  });

  it('measures real gyroscope bias and noise across all IMU frames', () => {
    const result = analyzeStationaryImu(Array.from({ length: 120 }, (_, index) => sample(index)));
    expect(result.measurements.frameCount).toBe(360);
    expect(result.measurements.gyroBiasDps).toBeGreaterThan(100);
    expect(result.measurements.gyroNoiseDps).toBeGreaterThan(50);
    expect(result.status).toBe('potential-issue');
  });

  it('classifies opposite-direction snapback after a release', () => {
    const points = [
      [0.55, 0],
      [0.25, 0],
      [0.05, 0],
      [-0.18, 0],
      [-0.08, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ] as const;
    const samples = Array.from({ length: 33 }, (_, index) => {
      const [x, y] = points[index % points.length];
      return sample(index, x, y);
    });
    const result = analyzeSnapback(samples, 'left');
    expect(result.measurements.detectedReleases).toBe(3);
    expect(result.measurements.peakOppositeExcursion).toBe(0.18);
    expect(result.status).toBe('potential-issue');
  });
});
