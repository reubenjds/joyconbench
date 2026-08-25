import type { CSSProperties } from 'react';
import type { ControllerSample, Vector3 } from '../types/controller';

const ZERO_VECTOR: Vector3 = { x: 0, y: 0, z: 0 };
const DISPLAY_RANGE_DPS = 500;

export function LiveGyroscope({ sample }: { sample: ControllerSample | null }) {
  const gyroscope = sample ? meanGyroscope(sample) : ZERO_VECTOR;
  const magnitude = Math.hypot(gyroscope.x, gyroscope.y, gyroscope.z);
  const pointerX = 80 + clamp(gyroscope.x / DISPLAY_RANGE_DPS) * 54;
  const pointerY = 80 - clamp(gyroscope.y / DISPLAY_RANGE_DPS) * 54;

  return (
    <section className="live-gyroscope" aria-label="Live gyroscope">
      <div className="gyro-heading">
        <div>
          <span>Motion sensor</span>
          <h2>Gyroscope</h2>
        </div>
        <output aria-label={`Total angular rate ${format(magnitude)} degrees per second`}>
          {format(magnitude)}
          <small>°/s</small>
        </output>
      </div>

      <svg
        className="gyro-vector"
        viewBox="0 0 160 160"
        role="img"
        aria-label="Live X and Y angular-rate vector"
      >
        <circle className="gyro-ring" cx="80" cy="80" r="61" />
        <path className="gyro-grid" d="M19 80h122M80 19v122" />
        <circle className="gyro-center" cx="80" cy="80" r="3" />
        <path className="gyro-vector-line" d={`M80 80L${pointerX} ${pointerY}`} />
        <circle className="gyro-vector-point" cx={pointerX} cy={pointerY} r="6" />
        <text x="145" y="76" textAnchor="end">
          X
        </text>
        <text x="85" y="15">
          Y
        </text>
      </svg>

      <dl className="gyro-axes">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis}>
            <dt>{axis.toUpperCase()}</dt>
            <dd>
              <div className="gyro-axis-track" aria-hidden="true">
                <i className="gyro-axis-zero" />
                <i className="gyro-axis-value" style={axisStyle(gyroscope[axis])} />
              </div>
              <output
                aria-label={`${axis.toUpperCase()} angular rate ${format(gyroscope[axis])} degrees per second`}
              >
                {signed(gyroscope[axis])}
              </output>
            </dd>
          </div>
        ))}
      </dl>
      <p>Three-frame mean · nominal scale · updates at 30 fps</p>
    </section>
  );
}

function meanGyroscope(sample: ControllerSample): Vector3 {
  return sample.imuFrames.reduce(
    (total, frame) => ({
      x: total.x + frame.gyroscope.x / sample.imuFrames.length,
      y: total.y + frame.gyroscope.y / sample.imuFrames.length,
      z: total.z + frame.gyroscope.z / sample.imuFrames.length,
    }),
    { ...ZERO_VECTOR }
  );
}

function axisStyle(value: number) {
  const level = Math.min(50, (Math.abs(value) / DISPLAY_RANGE_DPS) * 50);
  return {
    '--gyro-axis-left': `${value < 0 ? 50 - level : 50}%`,
    '--gyro-axis-width': `${level}%`,
  } as CSSProperties;
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function format(value: number) {
  return Math.abs(value) < 0.05 ? '0.0' : Math.abs(value).toFixed(1);
}

function signed(value: number) {
  if (Math.abs(value) < 0.05) return '0.0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
}
