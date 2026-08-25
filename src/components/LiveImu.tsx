import type { ControllerSample, Vector3 } from '../types/controller';

const AXES = [
  { key: 'x', label: 'X', className: 'imu-axis-x' },
  { key: 'y', label: 'Y', className: 'imu-axis-y' },
  { key: 'z', label: 'Z', className: 'imu-axis-z' },
] as const;

export function LiveImu({ samples }: { samples: ControllerSample[] }) {
  const frames = samples.slice(-60).flatMap((sample) => sample.imuFrames);
  const latest = frames.at(-1);
  const largestGyroReading = Math.max(
    0,
    ...frames.flatMap((frame) => [
      Math.abs(frame.gyroscope.x),
      Math.abs(frame.gyroscope.y),
      Math.abs(frame.gyroscope.z),
    ])
  );
  const scale = Math.max(20, Math.ceil(largestGyroReading / 20) * 20);

  return (
    <figure className="imu-monitor">
      <figcaption className="imu-monitor-heading">
        <div>
          <span>Live sensor input</span>
          <h2>Gyroscope</h2>
        </div>
        <strong>
          {latest ? `${samples.at(-1)!.imuFrames.length} frames / report` : 'Waiting'}
        </strong>
      </figcaption>

      <div className="imu-monitor-grid">
        <div className="imu-chart">
          <div className="imu-chart-key" aria-hidden="true">
            {AXES.map((axis) => (
              <span key={axis.key} className={axis.className}>
                <i /> {axis.label}
              </span>
            ))}
            <span className="imu-scale">±{scale}°/s</span>
          </div>
          <svg viewBox="0 0 600 220" role="img" aria-label="Live gyroscope X, Y, and Z axes">
            <path className="imu-grid-line" d="M0 30H600M0 110H600M0 190H600" />
            <path className="imu-grid-line imu-grid-vertical" d="M150 0V220M300 0V220M450 0V220" />
            {AXES.map((axis) => {
              const path = axisPath(
                frames.map((frame) => frame.gyroscope),
                axis.key,
                scale
              );
              return path ? <path key={axis.key} className={axis.className} d={path} /> : null;
            })}
          </svg>
        </div>

        <dl className="imu-readings">
          {AXES.map((axis) => (
            <div key={axis.key}>
              <dt>
                <span className={axis.className} aria-hidden="true" />
                {axis.label} axis
              </dt>
              <dd>
                <output aria-label={`Gyroscope ${axis.label}`}>
                  {formatReading(latest?.gyroscope[axis.key], '°/s')}
                </output>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="accelerometer-readings">
        <strong>Accelerometer</strong>
        {AXES.map((axis) => (
          <span key={axis.key}>
            {axis.label}
            <output aria-label={`Accelerometer ${axis.label}`}>
              {formatReading(latest?.accelerometer[axis.key], 'g')}
            </output>
          </span>
        ))}
      </div>
    </figure>
  );
}

function axisPath(vectors: Vector3[], axis: keyof Vector3, scale: number) {
  if (!vectors.length) return '';
  const interval = Math.max(1, vectors.length - 1);
  return vectors
    .map((vector, index) => {
      const x = (index / interval) * 600;
      const normalized = Math.max(-1, Math.min(1, vector[axis] / scale));
      const y = 110 - normalized * 80;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function formatReading(value: number | undefined, unit: string) {
  return value === undefined ? '—' : `${value.toFixed(2)} ${unit}`;
}
