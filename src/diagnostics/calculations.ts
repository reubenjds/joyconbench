import type {
  ControllerSample,
  DiagnosticResult,
  StickId,
  Vector2,
  Vector3,
} from '../types/controller';

export interface ThresholdProfile {
  version: string;
  classification: 'measurement-only' | 'research-based' | 'hardware-validated';
  stick: {
    neutralOffset: number;
    jitterRms: number;
    minimumRange: number;
    releaseArm: number;
    centerReturn: number;
    snapback: number;
  };
  imu: { gyroBiasDps: number; gyroNoiseDps: number; motionRangeDps: number };
  packets: { minimumRateHz: number; maximumP95IntervalMs: number; maximumDropRatio: number };
}

export const DEFAULT_THRESHOLDS: ThresholdProfile = {
  version: 'research-1',
  classification: 'research-based',
  stick: {
    neutralOffset: 0.08,
    jitterRms: 0.025,
    minimumRange: 0.45,
    releaseArm: 0.4,
    centerReturn: 0.12,
    snapback: 0.1,
  },
  imu: { gyroBiasDps: 10, gyroNoiseDps: 2.5, motionRangeDps: 50 },
  packets: { minimumRateHz: 52, maximumP95IntervalMs: 30, maximumDropRatio: 0.03 },
};

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function magnitude(point: Vector2) {
  return Math.hypot(point.x, point.y);
}

function statusFromThreshold(
  profile: ThresholdProfile,
  hasPotentialIssue: boolean
): DiagnosticResult['status'] {
  if (profile.classification === 'measurement-only') return 'inconclusive';
  return hasPotentialIssue ? 'potential-issue' : 'pass';
}

function classificationEnabled(profile: ThresholdProfile) {
  return profile.classification !== 'measurement-only';
}

function referenceRange(profile: ThresholdProfile) {
  return profile.classification === 'hardware-validated'
    ? 'hardware-validated reference range'
    : 'research-based reference range';
}

function thresholdMetadata(profile: ThresholdProfile) {
  return {
    thresholdProfile: profile.version,
    thresholdBasis: profile.classification,
  };
}

function stickPoints(samples: ControllerSample[], stick: StickId) {
  return samples.flatMap((sample) => (sample.sticks[stick] ? [sample.sticks[stick]] : []));
}

export function analyzeNeutral(
  samples: ControllerSample[],
  stick: StickId,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const points = stickPoints(samples, stick);
  if (points.length < 10) return insufficient('stick-neutral', 'Stick neutral', 'stick samples');
  const center = {
    x: mean(points.map((point) => point.x)),
    y: mean(points.map((point) => point.y)),
  };
  const centerOffset = magnitude(center);
  const jitterRms = Math.sqrt(
    mean(points.map((point) => (point.x - center.x) ** 2 + (point.y - center.y) ** 2))
  );
  const peakExcursion = Math.max(...points.map((point) => magnitude(point)));
  const potential =
    centerOffset > profile.stick.neutralOffset || jitterRms > profile.stick.jitterRms;

  return {
    testId: `stick-neutral-${stick}`,
    title: `${capitalize(stick)} stick neutral`,
    status: statusFromThreshold(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      centerOffset: round(centerOffset),
      horizontalOffset: round(center.x),
      verticalOffset: round(center.y),
      jitterRms: round(jitterRms),
      peakExcursion: round(peakExcursion),
      sampleCount: points.length,
    },
    explanation: 'The stick was measured without being touched for five seconds.',
    interpretation: classificationEnabled(profile)
      ? potential
        ? `The observed neutral position or noise exceeds the ${referenceRange(profile)}.`
        : `The observed neutral position and noise are within the ${referenceRange(profile)}.`
      : 'Measurements are available, but this profile does not classify them.',
    recommendations: potential
      ? [
          'Retest on a stable surface.',
          'Try console calibration.',
          'Consider cleaning or replacement if the result repeats.',
        ]
      : ['Keep this report as a baseline for future comparisons.'],
  };
}

export function analyzeRange(
  samples: ControllerSample[],
  stick: StickId,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const points = stickPoints(samples, stick);
  if (points.length < 30) return insufficient('stick-range', 'Circular range', 'stick samples');
  const bucketCount = 24;
  const buckets = Array<number>(bucketCount).fill(0);
  for (const point of points) {
    const angle = (Math.atan2(point.y, point.x) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.min(bucketCount - 1, Math.floor((angle / (Math.PI * 2)) * bucketCount));
    buckets[index] = Math.max(buckets[index], magnitude(point));
  }
  const reached = buckets.filter((radius) => radius > 0.25);
  const coverage = reached.length / bucketCount;
  const minimumReach = reached.length ? Math.min(...reached) : 0;
  const maximumReach = reached.length ? Math.max(...reached) : 0;
  const directionalImbalance = maximumReach - minimumReach;
  const potential = coverage < 0.9 || minimumReach < profile.stick.minimumRange;

  return {
    testId: `stick-range-${stick}`,
    title: `${capitalize(stick)} stick circular range`,
    status: statusFromThreshold(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      angularCoveragePercent: round(coverage * 100, 1),
      minimumReach: round(minimumReach),
      maximumReach: round(maximumReach),
      directionalImbalance: round(directionalImbalance),
      sampleCount: points.length,
    },
    explanation: 'Maximum reach was compared across 24 equal directional sectors.',
    interpretation: classificationEnabled(profile)
      ? potential
        ? 'The captured path suggests restricted or uneven stick travel.'
        : `The captured path reached the ${referenceRange(profile)} in every direction.`
      : 'Range is measured, but this profile does not classify it.',
    recommendations: potential
      ? [
          'Repeat three slow rotations.',
          'Try console calibration.',
          'Inspect for physical obstruction if restriction repeats.',
        ]
      : ['No action is suggested by this measurement.'],
  };
}

export function analyzeSnapback(
  samples: ControllerSample[],
  stick: StickId,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const points = stickPoints(samples, stick);
  if (points.length < 20)
    return insufficient('stick-snapback', 'Release and snapback', 'stick samples');
  let releaseDirection: Vector2 | null = null;
  let crossedCenter = false;
  let framesAfterCenter = 0;
  let peakAfterRelease = 0;
  let releases = 0;
  for (const point of points) {
    const radius = magnitude(point);
    if (!releaseDirection) {
      if (radius >= profile.stick.releaseArm) {
        releaseDirection = { x: point.x / radius, y: point.y / radius };
      }
      continue;
    }
    if (!crossedCenter) {
      if (radius >= profile.stick.releaseArm) {
        releaseDirection = { x: point.x / radius, y: point.y / radius };
      } else if (radius <= profile.stick.centerReturn) {
        releases += 1;
        crossedCenter = true;
        framesAfterCenter = 0;
      }
      continue;
    }

    peakAfterRelease = Math.max(
      peakAfterRelease,
      -(point.x * releaseDirection.x + point.y * releaseDirection.y)
    );
    framesAfterCenter += 1;
    if (radius >= profile.stick.releaseArm) {
      releaseDirection = { x: point.x / radius, y: point.y / radius };
      crossedCenter = false;
    } else if (framesAfterCenter >= 8) {
      releaseDirection = null;
      crossedCenter = false;
    }
  }
  const potential = releases > 0 && peakAfterRelease > profile.stick.snapback;
  return {
    testId: `stick-snapback-${stick}`,
    title: `${capitalize(stick)} stick release`,
    status: releases === 0 ? 'inconclusive' : statusFromThreshold(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      detectedReleases: releases,
      peakOppositeExcursion: round(peakAfterRelease),
    },
    explanation: 'Return-to-center behavior was measured after high-reach movements.',
    interpretation:
      releases === 0
        ? 'No clear release was captured. Repeat the test with a firm flick and release.'
        : classificationEnabled(profile)
          ? potential
            ? 'The return path shows a potential snapback pattern.'
            : `The captured releases returned within the ${referenceRange(profile)}.`
          : 'Release events were captured, but this profile does not classify them.',
    recommendations:
      releases === 0
        ? ['Repeat the guided release test.']
        : potential
          ? ['Repeat the test.', 'Consider repair if unintended reverse input is reproducible.']
          : ['No action is suggested by this measurement.'],
  };
}

function imuVectors(samples: ControllerSample[], key: 'accelerometer' | 'gyroscope') {
  return samples.flatMap((sample) => sample.imuFrames.map((frame) => frame[key]));
}

function axisMetrics(vectors: Vector3[]) {
  return {
    mean: {
      x: mean(vectors.map((vector) => vector.x)),
      y: mean(vectors.map((vector) => vector.y)),
      z: mean(vectors.map((vector) => vector.z)),
    },
    noise: {
      x: standardDeviation(vectors.map((vector) => vector.x)),
      y: standardDeviation(vectors.map((vector) => vector.y)),
      z: standardDeviation(vectors.map((vector) => vector.z)),
    },
  };
}

export function analyzeStationaryImu(
  samples: ControllerSample[],
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const vectors = imuVectors(samples, 'gyroscope');
  if (vectors.length < 30) return insufficient('imu-stationary', 'Gyroscope at rest', 'IMU frames');
  const metrics = axisMetrics(vectors);
  const bias = Math.hypot(metrics.mean.x, metrics.mean.y, metrics.mean.z);
  const noise = Math.hypot(metrics.noise.x, metrics.noise.y, metrics.noise.z);
  const potential = bias > profile.imu.gyroBiasDps || noise > profile.imu.gyroNoiseDps;
  return {
    testId: 'imu-stationary',
    title: 'Gyroscope at rest',
    status: statusFromThreshold(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      gyroBiasDps: round(bias),
      gyroNoiseDps: round(noise),
      frameCount: vectors.length,
    },
    explanation: 'Gyroscope bias and noise were measured while the controller was stationary.',
    interpretation: classificationEnabled(profile)
      ? potential
        ? `The stationary sensor signal exceeds the ${referenceRange(profile)}.`
        : `The stationary sensor signal is within the ${referenceRange(profile)}.`
      : 'Sensor measurements are available, but this profile does not classify them.',
    recommendations: potential
      ? [
          'Retest on a motionless surface.',
          'Reconnect the controller before considering hardware service.',
        ]
      : ['No action is suggested by this measurement.'],
  };
}

export function analyzeMotion(
  samples: ControllerSample[],
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const gyro = imuVectors(samples, 'gyroscope');
  const accelerometer = imuVectors(samples, 'accelerometer');
  if (gyro.length < 30) return insufficient('imu-motion', 'Gyroscope axes', 'IMU frames');
  const range = (vectors: Vector3[], axis: keyof Vector3) => {
    const values = vectors.map((vector) => vector[axis]);
    return Math.max(...values) - Math.min(...values);
  };
  const gyroRanges = { x: range(gyro, 'x'), y: range(gyro, 'y'), z: range(gyro, 'z') };
  const accelRanges = {
    x: range(accelerometer, 'x'),
    y: range(accelerometer, 'y'),
    z: range(accelerometer, 'z'),
  };
  const responsiveAxes = Object.values(gyroRanges).filter(
    (value) => value >= profile.imu.motionRangeDps
  ).length;
  return {
    testId: 'imu-motion',
    title: 'Gyroscope axes',
    status: statusFromThreshold(profile, responsiveAxes !== 3),
    measurements: {
      ...thresholdMetadata(profile),
      gyroRangeX: round(gyroRanges.x, 1),
      gyroRangeY: round(gyroRanges.y, 1),
      gyroRangeZ: round(gyroRanges.z, 1),
      accelerometerRangeX: round(accelRanges.x),
      accelerometerRangeY: round(accelRanges.y),
      accelerometerRangeZ: round(accelRanges.z),
      responsiveAxes,
    },
    explanation: 'Each gyroscope and accelerometer axis was checked for a changing signal.',
    interpretation: classificationEnabled(profile)
      ? responsiveAxes === 3
        ? `All three gyroscope axes reached the ${referenceRange(profile)}.`
        : 'One or more motion axes did not show the expected response.'
      : 'Axis responses were measured, but this profile does not classify them.',
    recommendations:
      responsiveAxes === 3
        ? ['No action is suggested by this functional check.']
        : [
            'Repeat while rotating around every axis.',
            'Reconnect and retest if an axis remains inactive.',
          ],
  };
}

export function analyzePackets(
  samples: ControllerSample[],
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  if (samples.length < 20)
    return insufficient('packet-stability', 'Packet stability', 'input reports');
  const duration = (samples.at(-1)!.timestamp - samples[0].timestamp) / 1000;
  const intervals = samples
    .slice(1)
    .map((sample, index) => sample.timestamp - samples[index].timestamp);
  const sorted = [...intervals].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  let dropped = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const difference =
      (samples[index].packetCounter - samples[index - 1].packetCounter + 256) % 256;
    if (difference > 1) dropped += difference - 1;
  }
  const rate = duration > 0 ? (samples.length - 1) / duration : 0;
  const dropRatio = dropped / Math.max(1, samples.length + dropped);
  const potential =
    rate < profile.packets.minimumRateHz ||
    p95 > profile.packets.maximumP95IntervalMs ||
    dropRatio > profile.packets.maximumDropRatio;
  return {
    testId: 'packet-stability',
    title: 'Packet stability',
    status: statusFromThreshold(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      rateHz: round(rate, 1),
      medianIntervalMs: round(sorted[Math.floor(sorted.length / 2)], 1),
      p95IntervalMs: round(p95, 1),
      counterDiscontinuities: dropped,
      dropPercent: round(dropRatio * 100, 1),
    },
    explanation: 'Input timing and controller packet-counter continuity were measured.',
    interpretation: classificationEnabled(profile)
      ? potential
        ? 'The connection showed potential instability.'
        : `The connection remained within the ${referenceRange(profile)}.`
      : 'Packet measurements are available, but this profile does not classify them.',
    recommendations: potential
      ? ['Move closer to the computer.', 'Reduce Bluetooth interference.', 'Reconnect and repeat.']
      : ['No action is suggested by this measurement.'],
  };
}

export function createConfirmationResult(
  testId: string,
  title: string,
  answer: 'yes' | 'no' | 'skipped'
): DiagnosticResult {
  if (answer === 'skipped') {
    return {
      testId,
      title,
      status: 'skipped',
      measurements: { userConfirmed: false },
      explanation: 'This optional test was skipped.',
      interpretation: 'No conclusion was recorded.',
      recommendations: ['Repeat the optional test if this feature is relevant to the repair.'],
    };
  }
  return {
    testId,
    title,
    status: answer === 'yes' ? 'pass' : 'potential-issue',
    measurements: { userConfirmed: answer === 'yes' },
    explanation: 'The result is based on the user’s direct confirmation.',
    interpretation:
      answer === 'yes'
        ? `${title} responded as expected.`
        : `${title} was not observed during the test.`,
    recommendations:
      answer === 'yes'
        ? ['No action is suggested by this check.']
        : ['Reconnect and repeat the test.'],
  };
}

function insufficient(testId: string, title: string, expected: string): DiagnosticResult {
  return {
    testId,
    title,
    status: 'inconclusive',
    measurements: { sampleCount: 0 },
    explanation: `There were not enough ${expected} to calculate this result.`,
    interpretation: 'Repeat this guided test while the controller remains connected.',
    recommendations: ['Repeat the test.'],
  };
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
