import { describe, expect, it } from 'vitest';
import type { ControllerSample, DiagnosticResult, Vector3 } from '../types/controller';
import { EMPTY_BUTTONS } from '../types/controller';
import {
  DEFAULT_THRESHOLDS,
  analyzeMotion,
  analyzeNeutral,
  analyzePackets,
  analyzeRange,
  analyzeSnapback,
  analyzeStationaryImu,
  applyIssueConfirmation,
} from './calculations';

function sample(
  index: number,
  x = 0,
  y = 0,
  gyroscope: Vector3 = { x: 0.2, y: -0.1, z: 0.1 },
  accelerometer: Vector3 = { x: 0, y: 0, z: 1 }
): ControllerSample {
  return {
    timestamp: index * (1000 / 60),
    buttons: { ...EMPTY_BUTTONS },
    sticks: { left: { x, y } },
    rawSticks: { left: { x: 2048 + x * 2047, y: 2048 + y * 2047 } },
    imuFrames: [0, 1, 2].map((frame) => ({
      offsetMs: frame * 5,
      accelerometer,
      gyroscope,
    })) as unknown as ControllerSample['imuFrames'],
    battery: { percentage: 100, charging: false },
    reportTimer: (index * 3) & 0xff,
    connection: 'bluetooth',
    calibration: { sticks: { left: 'factory' }, imu: 'factory' },
  };
}

describe('research-2 diagnostic calculations', () => {
  it('requires a repeated valid concern before reporting a potential issue', () => {
    const candidate = analyzeNeutral(
      Array.from({ length: 300 }, (_, index) => sample(index, 0.2, 0)),
      'left'
    );
    expect(DEFAULT_THRESHOLDS.version).toBe('research-2');
    expect(candidate.status).toBe('check-again');
    const first = applyIssueConfirmation(candidate);
    const second = applyIssueConfirmation(candidate, first.state);
    expect(first.result.status).toBe('check-again');
    expect(second.result.status).toBe('potential-issue');
  });

  it('clears confirmation after a passing capture and preserves it after an inconclusive one', () => {
    const concern = result('check-again');
    const pending = applyIssueConfirmation(concern);
    expect(applyIssueConfirmation(result('inconclusive'), pending.state).state?.concernCount).toBe(
      1
    );
    expect(applyIssueConfirmation(result('pass'), pending.state).state).toBeUndefined();
  });

  it('does not confirm a different finding from the same test', () => {
    const first = applyIssueConfirmation(result('check-again', 'offset'));
    const second = applyIssueConfirmation(result('check-again', 'noise'), first.state);
    expect(second.result.status).toBe('check-again');
    expect(second.state?.concernCount).toBe(1);
  });

  it('treats a brief stick touch as inconclusive instead of drift', () => {
    const samples = Array.from({ length: 300 }, (_, index) =>
      sample(index, index === 150 ? 0.8 : 0, 0)
    );
    expect(analyzeNeutral(samples, 'left').status).toBe('inconclusive');
  });

  it('accepts two full calibrated edge rotations', () => {
    const samples = Array.from({ length: 720 }, (_, index) => {
      const angle = (index / 719) * Math.PI * 4;
      return sample(index, Math.cos(angle), Math.sin(angle));
    });
    const result = analyzeRange(samples, 'left');
    expect(result.status).toBe('pass');
    expect(result.measurements.angularCoveragePercent).toBe(100);
    expect(result.measurements.lowerSectorReach).toBeGreaterThan(0.95);
  });

  it('asks for another range capture when directions are missing', () => {
    const samples = Array.from({ length: 720 }, (_, index) => {
      const angle = (index / 719) * Math.PI;
      return sample(index, Math.cos(angle), Math.sin(angle));
    });
    expect(analyzeRange(samples, 'left').status).toBe('inconclusive');
  });

  it('does not infer packet loss from non-unit timer increments or wrapping', () => {
    const result = analyzePackets(Array.from({ length: 600 }, (_, index) => sample(index)));
    expect(result.status).toBe('pass');
    expect(result.measurements.rateHz).toBeCloseTo(60, 1);
    expect(result.measurements).not.toHaveProperty('counterDiscontinuities');
    expect(result.measurements.reportTimerWraps).toBeGreaterThan(0);
  });

  it('rejects background-tab connection captures', () => {
    expect(
      analyzePackets(
        Array.from({ length: 600 }, (_, index) => sample(index)),
        false
      ).status
    ).toBe('inconclusive');
  });

  it('confirms each separately guided motion axis', () => {
    const capture = (axis: keyof Vector3) =>
      Array.from({ length: 240 }, (_, index) => {
        const value = Math.sin(index / 12) * 80;
        return sample(index, 0, 0, {
          x: axis === 'x' ? value : 0,
          y: axis === 'y' ? value : 0,
          z: axis === 'z' ? value : 0,
        });
      });
    const result = analyzeMotion({ x: capture('x'), y: capture('y'), z: capture('z') });
    expect(result.measurements.responsiveAxes).toBe(3);
    expect(result.status).toBe('pass');
  });

  it('uses stable calibrated stationary data without inheriting raw bias', () => {
    const result = analyzeStationaryImu(Array.from({ length: 300 }, (_, index) => sample(index)));
    expect(result.status).toBe('pass');
    expect(result.measurements.imuCalibration).toBe('factory');
  });

  it('rejects a stationary capture when accelerometer data shows movement', () => {
    const samples = Array.from({ length: 300 }, (_, index) =>
      sample(index, 0, 0, undefined, { x: Math.sin(index / 3) * 0.2, y: 0, z: 1 })
    );
    expect(analyzeStationaryImu(samples).status).toBe('inconclusive');
  });

  it('requires repeated snapback across four captured directions', () => {
    const directions = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    const points = directions.flatMap((direction, index) => [
      { x: direction.x * 0.7, y: direction.y * 0.7 },
      { x: 0, y: 0 },
      { x: index < 2 ? direction.x * -0.2 : 0, y: index < 2 ? direction.y * -0.2 : 0 },
      ...Array.from({ length: 7 }, () => ({ x: 0, y: 0 })),
    ]);
    const samples = Array.from({ length: 420 }, (_, index) => {
      const point = points[index] ?? { x: 0, y: 0 };
      return sample(index, point.x, point.y);
    });
    const analyzed = analyzeSnapback(samples, 'left');
    expect(analyzed.measurements.concerningReleases).toBe(2);
    expect(analyzed.status).toBe('check-again');
  });
});

function result(status: DiagnosticResult['status'], findingCode?: string): DiagnosticResult {
  return {
    testId: 'fixture',
    title: 'Fixture',
    status,
    measurements: findingCode ? { findingCode } : {},
    explanation: '',
    interpretation: '',
    recommendations: [],
  };
}
