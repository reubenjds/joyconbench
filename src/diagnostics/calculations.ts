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
    maximumImbalance: number;
    releaseArm: number;
    centerReturn: number;
    snapback: number;
  };
  imu: {
    gyroBiasDps: number;
    gyroNoiseDps: number;
    motionRangeDps: number;
    accelerometerStabilityG: number;
  };
  packets: { minimumRateHz: number; maximumP95IntervalMs: number };
}

export const DEFAULT_THRESHOLDS: ThresholdProfile = {
  version: 'research-2',
  classification: 'research-based',
  stick: {
    neutralOffset: 0.15,
    jitterRms: 0.05,
    minimumRange: 0.75,
    maximumImbalance: 0.35,
    releaseArm: 0.4,
    centerReturn: 0.15,
    snapback: 0.15,
  },
  imu: {
    gyroBiasDps: 10,
    gyroNoiseDps: 2.5,
    motionRangeDps: 50,
    accelerometerStabilityG: 0.08,
  },
  packets: { minimumRateHz: 45, maximumP95IntervalMs: 40 },
};

export interface ConfirmationState {
  findingCode: string;
  concernCount: number;
}

export function applyIssueConfirmation(
  result: DiagnosticResult,
  previousState?: ConfirmationState
) {
  if (result.status === 'pass') return { result, state: undefined };
  if (result.status !== 'check-again') return { result, state: previousState };
  const findingCode = String(result.measurements.findingCode ?? result.testId);
  const concernCount =
    previousState?.findingCode === findingCode ? previousState.concernCount + 1 : 1;
  const state = { findingCode, concernCount };
  if (concernCount < 2) {
    return {
      state,
      result: {
        ...result,
        measurements: { ...result.measurements, confirmationAttempts: concernCount },
      },
    };
  }
  return {
    state,
    result: {
      ...result,
      status: 'potential-issue' as const,
      measurements: { ...result.measurements, confirmationAttempts: concernCount },
      interpretation: `The same finding was reproduced in two valid captures. ${result.interpretation}`,
      recommendations: result.recommendations.filter((item) => item !== 'Retry this test.'),
    },
  };
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], proportion: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * proportion))];
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function magnitude(point: Vector2 | Vector3) {
  return 'z' in point ? Math.hypot(point.x, point.y, point.z) : Math.hypot(point.x, point.y);
}

function classificationStatus(profile: ThresholdProfile, potential: boolean) {
  if (profile.classification === 'measurement-only') return 'inconclusive' as const;
  return potential ? ('check-again' as const) : ('pass' as const);
}

function referenceRange(profile: ThresholdProfile) {
  return profile.classification === 'hardware-validated'
    ? 'hardware-validated reference range'
    : 'research-based reference range';
}

function thresholdMetadata(profile: ThresholdProfile) {
  return { thresholdProfile: profile.version, thresholdBasis: profile.classification };
}

function calibrationMetadata(samples: ControllerSample[], stick?: StickId) {
  const calibration = samples[0]?.calibration;
  return {
    ...(stick ? { stickCalibration: calibration?.sticks[stick] ?? 'nominal' } : {}),
    imuCalibration: calibration?.imu ?? 'nominal',
  };
}

function captureDurationMs(samples: ControllerSample[]) {
  return samples.length > 1 ? samples.at(-1)!.timestamp - samples[0].timestamp : 0;
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
  if (points.length < 200 || captureDurationMs(samples) < 4000) {
    return insufficient(
      `stick-neutral-${stick}`,
      `${capitalize(stick)} stick neutral`,
      'a full five-second stick capture'
    );
  }
  const center = {
    x: median(points.map((point) => point.x)),
    y: median(points.map((point) => point.y)),
  };
  const deviations = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const trimmed = [...deviations]
    .sort((a, b) => a - b)
    .slice(0, Math.ceil(deviations.length * 0.95));
  const jitterRms = Math.sqrt(mean(trimmed.map((value) => value ** 2)));
  const centerOffset = magnitude(center);
  if (Math.max(...deviations) > 0.35 && percentile(deviations, 0.95) < 0.1) {
    return inconclusive(
      `stick-neutral-${stick}`,
      `${capitalize(stick)} stick neutral`,
      'The stick moved briefly during the capture. Put the controller down and retry.'
    );
  }
  const potential =
    centerOffset > profile.stick.neutralOffset || jitterRms > profile.stick.jitterRms;
  const findingCode =
    centerOffset > profile.stick.neutralOffset && jitterRms > profile.stick.jitterRms
      ? 'neutral-offset-and-noise'
      : centerOffset > profile.stick.neutralOffset
        ? 'neutral-offset'
        : 'stick-noise';
  return {
    testId: `stick-neutral-${stick}`,
    title: `${capitalize(stick)} stick neutral`,
    status: classificationStatus(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      ...calibrationMetadata(samples, stick),
      centerOffset: round(centerOffset),
      horizontalOffset: round(center.x),
      verticalOffset: round(center.y),
      trimmedJitterRms: round(jitterRms),
      peakExcursion: round(Math.max(...points.map((point) => magnitude(point)))),
      sampleCount: points.length,
      ...(potential ? { findingCode } : {}),
    },
    explanation: 'The median neutral position and trimmed noise were measured for five seconds.',
    interpretation: potential
      ? `This capture exceeded the ${referenceRange(profile)}. Check it again before treating it as an issue.`
      : `The neutral position and noise are within the ${referenceRange(profile)}.`,
    recommendations: potential
      ? ['Retry this test.', 'Try console calibration if the finding repeats.']
      : ['Keep this report as a baseline.'],
  };
}

export function analyzeRange(
  samples: ControllerSample[],
  stick: StickId,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const points = stickPoints(samples, stick);
  if (points.length < 300 || captureDurationMs(samples) < 9600) {
    return insufficient(
      `stick-range-${stick}`,
      `${capitalize(stick)} stick circular range`,
      'the full circular-range capture'
    );
  }
  const buckets = Array<number>(16).fill(0);
  let angularTravel = 0;
  let previousAngle: number | null = null;
  for (const point of points) {
    const radius = magnitude(point);
    if (radius < 0.35) continue;
    const angle = (Math.atan2(point.y, point.x) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.min(15, Math.floor((angle / (Math.PI * 2)) * 16));
    buckets[index] = Math.max(buckets[index], radius);
    if (previousAngle !== null) {
      let delta = angle - previousAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) < Math.PI / 2) angularTravel += Math.abs(delta);
    }
    previousAngle = angle;
  }
  const reached = buckets.filter((radius) => radius > 0);
  const rotations = angularTravel / (Math.PI * 2);
  if (reached.length < 14 || rotations < 1.9) {
    return inconclusive(
      `stick-range-${stick}`,
      `${capitalize(stick)} stick circular range`,
      'The path did not cover enough directions or complete two rotations. Retry with two slow edge rotations.'
    );
  }
  const lowerSectorReach = percentile(reached, 0.1);
  const maximumReach = Math.max(...reached);
  const imbalance = maximumReach - Math.min(...reached);
  const potential =
    lowerSectorReach < profile.stick.minimumRange || imbalance > profile.stick.maximumImbalance;
  const findingCode =
    lowerSectorReach < profile.stick.minimumRange && imbalance > profile.stick.maximumImbalance
      ? 'restricted-and-uneven-range'
      : lowerSectorReach < profile.stick.minimumRange
        ? 'restricted-range'
        : 'uneven-range';
  return {
    testId: `stick-range-${stick}`,
    title: `${capitalize(stick)} stick circular range`,
    status: classificationStatus(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      ...calibrationMetadata(samples, stick),
      angularCoveragePercent: round((reached.length / 16) * 100, 1),
      completedRotations: round(rotations, 1),
      lowerSectorReach: round(lowerSectorReach),
      maximumReach: round(maximumReach),
      directionalImbalance: round(imbalance),
      sampleCount: points.length,
      ...(potential ? { findingCode } : {}),
    },
    explanation: 'Calibrated reach was compared across 16 directional sectors.',
    interpretation: potential
      ? 'The usable capture showed restricted or uneven travel. Check it again before treating it as an issue.'
      : `The captured path is within the ${referenceRange(profile)}.`,
    recommendations: potential
      ? ['Retry this test.', 'Try console calibration if it repeats.']
      : ['No action is suggested.'],
  };
}

interface ReleaseMeasurement {
  quadrant: number;
  oppositeExcursion: number;
}

export function analyzeSnapback(
  samples: ControllerSample[],
  stick: StickId,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const points = stickPoints(samples, stick);
  if (points.length < 200 || captureDurationMs(samples) < 6400) {
    return insufficient(
      `stick-snapback-${stick}`,
      `${capitalize(stick)} stick release`,
      'the full release capture'
    );
  }
  const releases: ReleaseMeasurement[] = [];
  let direction: Vector2 | null = null;
  let quadrant = -1;
  let framesAfterCenter = -1;
  let peak = 0;
  const finish = () => {
    if (direction && framesAfterCenter >= 0) releases.push({ quadrant, oppositeExcursion: peak });
    direction = null;
    framesAfterCenter = -1;
    peak = 0;
  };
  for (const point of points) {
    const radius = magnitude(point);
    if (!direction) {
      if (radius >= profile.stick.releaseArm) {
        direction = { x: point.x / radius, y: point.y / radius };
        quadrant = cardinalDirection(direction);
      }
      continue;
    }
    if (framesAfterCenter < 0) {
      if (radius >= profile.stick.releaseArm) {
        direction = { x: point.x / radius, y: point.y / radius };
        quadrant = cardinalDirection(direction);
      } else if (radius <= profile.stick.centerReturn) framesAfterCenter = 0;
      continue;
    }
    peak = Math.max(peak, -(point.x * direction.x + point.y * direction.y));
    framesAfterCenter += 1;
    if (framesAfterCenter >= 8) finish();
  }
  finish();
  const directions = new Set(releases.map((release) => release.quadrant));
  if (releases.length < 4 || directions.size < 4) {
    return inconclusive(
      `stick-snapback-${stick}`,
      `${capitalize(stick)} stick release`,
      'Four clear releases from up, down, left, and right were not captured.'
    );
  }
  const concerningReleases = releases.filter(
    (release) => release.oppositeExcursion > profile.stick.snapback
  ).length;
  const potential = concerningReleases >= 2;
  return {
    testId: `stick-snapback-${stick}`,
    title: `${capitalize(stick)} stick release`,
    status: classificationStatus(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      ...calibrationMetadata(samples, stick),
      detectedReleases: releases.length,
      coveredDirections: directions.size,
      concerningReleases,
      ...(potential ? { findingCode: 'repeated-snapback' } : {}),
      peakOppositeExcursion: round(
        Math.max(...releases.map((release) => release.oppositeExcursion))
      ),
    },
    explanation: 'Return-to-center behavior was measured across four release directions.',
    interpretation: potential
      ? 'Repeated releases showed an opposite-direction excursion. Check it again before treating it as an issue.'
      : `The captured releases are within the ${referenceRange(profile)}.`,
    recommendations: potential
      ? ['Retry this test.', 'Consider repair only if reverse input is reproducible.']
      : ['No action is suggested.'],
  };
}

function imuVectors(samples: ControllerSample[], key: 'accelerometer' | 'gyroscope') {
  return samples.flatMap((sample) => sample.imuFrames.map((frame) => frame[key]));
}

function axisMetrics(vectors: Vector3[]) {
  return {
    mean: {
      x: mean(vectors.map((v) => v.x)),
      y: mean(vectors.map((v) => v.y)),
      z: mean(vectors.map((v) => v.z)),
    },
    noise: {
      x: standardDeviation(vectors.map((v) => v.x)),
      y: standardDeviation(vectors.map((v) => v.y)),
      z: standardDeviation(vectors.map((v) => v.z)),
    },
  };
}

export function analyzeStationaryImu(
  samples: ControllerSample[],
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const gyro = imuVectors(samples, 'gyroscope');
  const accelerometer = imuVectors(samples, 'accelerometer');
  if (samples.length < 200 || gyro.length < 600 || captureDurationMs(samples) < 4000) {
    return insufficient('imu-stationary', 'Gyroscope at rest', 'a full five-second IMU capture');
  }
  const center = {
    x: median(accelerometer.map((v) => v.x)),
    y: median(accelerometer.map((v) => v.y)),
    z: median(accelerometer.map((v) => v.z)),
  };
  const accelP95 = percentile(
    accelerometer.map((v) => Math.hypot(v.x - center.x, v.y - center.y, v.z - center.z)),
    0.95
  );
  if (accelP95 > profile.imu.accelerometerStabilityG) {
    return inconclusive(
      'imu-stationary',
      'Gyroscope at rest',
      'The controller moved during the capture. Put it on a stable surface and retry.'
    );
  }
  const cutoff = percentile(
    gyro.map((vector) => magnitude(vector)),
    0.95
  );
  const metrics = axisMetrics(gyro.filter((vector) => magnitude(vector) <= cutoff));
  const bias = magnitude(metrics.mean);
  const noise = magnitude(metrics.noise);
  const potential = bias > profile.imu.gyroBiasDps || noise > profile.imu.gyroNoiseDps;
  const findingCode =
    bias > profile.imu.gyroBiasDps && noise > profile.imu.gyroNoiseDps
      ? 'gyro-bias-and-noise'
      : bias > profile.imu.gyroBiasDps
        ? 'gyro-bias'
        : 'gyro-noise';
  return {
    testId: 'imu-stationary',
    title: 'Gyroscope at rest',
    status: classificationStatus(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      ...calibrationMetadata(samples),
      gyroBiasDps: round(bias),
      gyroNoiseDps: round(noise),
      accelerometerP95DeviationG: round(accelP95),
      frameCount: gyro.length,
      ...(potential ? { findingCode } : {}),
    },
    explanation: 'Calibrated gyro bias and trimmed noise were measured after verifying stability.',
    interpretation: potential
      ? `The stationary signal exceeded the ${referenceRange(profile)}. Check it again before treating it as an issue.`
      : `The stationary signal is within the ${referenceRange(profile)}.`,
    recommendations: potential
      ? ['Retry this test.', 'Reconnect before considering service.']
      : ['No action is suggested.'],
  };
}

export type MotionCaptures = Record<keyof Vector3, ControllerSample[]>;

export function analyzeMotion(
  captures: MotionCaptures,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  const axes = ['x', 'y', 'z'] as const;
  if (
    !axes.every((axis) => captures[axis].length >= 120 && captureDurationMs(captures[axis]) >= 3000)
  ) {
    return insufficient('imu-motion', 'Gyroscope axes', 'all three guided axis captures');
  }
  const ranges = Object.fromEntries(
    axes.map((axis) => {
      const values = imuVectors(captures[axis], 'gyroscope').map((vector) => vector[axis]);
      return [axis, percentile(values, 0.99) - percentile(values, 0.01)];
    })
  ) as Record<keyof Vector3, number>;
  const responsiveAxes = axes.filter((axis) => ranges[axis] >= profile.imu.motionRangeDps).length;
  const potential = responsiveAxes !== 3;
  const inactiveAxes = axes.filter((axis) => ranges[axis] < profile.imu.motionRangeDps);
  return {
    testId: 'imu-motion',
    title: 'Gyroscope axes',
    status: classificationStatus(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      ...calibrationMetadata(captures.x),
      gyroRangeX: round(ranges.x, 1),
      gyroRangeY: round(ranges.y, 1),
      gyroRangeZ: round(ranges.z, 1),
      responsiveAxes,
      ...(potential ? { findingCode: `inactive-gyro-${inactiveAxes.join('')}` } : {}),
    },
    explanation: 'Each gyroscope axis was measured during its own guided rotation.',
    interpretation: potential
      ? 'One or more guided axes did not show the expected response. Check all three again before treating it as an issue.'
      : `All three axes reached the ${referenceRange(profile)}.`,
    recommendations: potential
      ? ['Retry this test.', 'Rotate deliberately around the named axis.']
      : ['No action is suggested.'],
  };
}

export function analyzePackets(
  samples: ControllerSample[],
  pageStayedVisible = true,
  profile = DEFAULT_THRESHOLDS
): DiagnosticResult {
  if (!pageStayedVisible)
    return inconclusive(
      'packet-stability',
      'Packet stability',
      'The page was hidden during capture, so browser scheduling could distort the result.'
    );
  if (samples.length < 20 || captureDurationMs(samples) < 8000)
    return insufficient(
      'packet-stability',
      'Packet stability',
      'a full ten-second foreground capture'
    );
  const duration = captureDurationMs(samples) / 1000;
  const intervals = samples
    .slice(1)
    .map((sample, index) => sample.timestamp - samples[index].timestamp);
  const rate = (samples.length - 1) / duration;
  const p95 = percentile(intervals, 0.95);
  const timerWraps = samples
    .slice(1)
    .filter((sample, index) => sample.reportTimer < samples[index].reportTimer).length;
  const potential =
    rate < profile.packets.minimumRateHz || p95 > profile.packets.maximumP95IntervalMs;
  const findingCode =
    rate < profile.packets.minimumRateHz && p95 > profile.packets.maximumP95IntervalMs
      ? 'slow-and-uneven-delivery'
      : rate < profile.packets.minimumRateHz
        ? 'slow-delivery'
        : 'uneven-delivery';
  return {
    testId: 'packet-stability',
    title: 'Packet stability',
    status: classificationStatus(profile, potential),
    measurements: {
      ...thresholdMetadata(profile),
      ...calibrationMetadata(samples),
      rateHz: round(rate, 1),
      medianIntervalMs: round(median(intervals), 1),
      p95IntervalMs: round(p95, 1),
      reportTimerStart: samples[0].reportTimer,
      reportTimerEnd: samples.at(-1)!.reportTimer,
      reportTimerWraps: timerWraps,
      ...(potential ? { findingCode } : {}),
    },
    explanation:
      'Foreground WebHID arrival timing was measured; the controller timer was informational only.',
    interpretation: potential
      ? 'The foreground capture showed slow or uneven delivery. Check it again before treating it as a connection issue.'
      : `Report delivery remained within the ${referenceRange(profile)}.`,
    recommendations: potential
      ? ['Retry this test.', 'Move closer and reduce Bluetooth interference.']
      : ['No action is suggested.'],
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
      recommendations: ['Repeat the optional test if this feature matters.'],
    };
  }
  return {
    testId,
    title,
    status: answer === 'yes' ? 'pass' : 'check-again',
    measurements: {
      userConfirmed: answer === 'yes',
      ...(answer === 'no' ? { findingCode: 'no-response' } : {}),
    },
    explanation: 'The result is based on the user’s direct confirmation.',
    interpretation:
      answer === 'yes'
        ? `${title} responded as expected.`
        : `${title} was not observed. Check it again before treating it as an issue.`,
    recommendations: answer === 'yes' ? ['No action is suggested.'] : ['Retry this test.'],
  };
}

function insufficient(testId: string, title: string, expected: string): DiagnosticResult {
  return inconclusive(testId, title, `There were not enough samples for ${expected}.`);
}

function inconclusive(testId: string, title: string, interpretation: string): DiagnosticResult {
  return {
    testId,
    title,
    status: 'inconclusive',
    measurements: { usableCapture: false },
    explanation: 'This capture could not support a reliable classification.',
    interpretation,
    recommendations: ['Retry this test.'],
  };
}

function cardinalDirection(point: Vector2) {
  if (Math.abs(point.x) >= Math.abs(point.y)) return point.x >= 0 ? 0 : 2;
  return point.y >= 0 ? 1 : 3;
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
