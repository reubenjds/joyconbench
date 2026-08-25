import type { ControllerSample, StickId, Vector2 } from '../types/controller';

const PLOT_CENTER = 90;
const PLOT_RADIUS = 66;
const TRAIL_SAMPLES = 120;

export function LiveJoysticks({
  latestSample,
  samples,
  sticks,
}: {
  latestSample: ControllerSample | null;
  samples: ControllerSample[];
  sticks: StickId[];
}) {
  return (
    <section className="live-joysticks" aria-label="Live joystick movement">
      <div className="joystick-heading">
        <div>
          <span>Live position</span>
          <h2>Joystick movement</h2>
        </div>
        <strong>{sticks.length === 1 ? '1 stick' : `${sticks.length} sticks`}</strong>
      </div>

      <div className="joystick-monitor-grid">
        {sticks.map((stick) => (
          <StickMonitor key={stick} stick={stick} latestSample={latestSample} samples={samples} />
        ))}
      </div>

      <p>Nominal centre 2048 · recent movement trail</p>
    </section>
  );
}

function StickMonitor({
  stick,
  latestSample,
  samples,
}: {
  stick: StickId;
  latestSample: ControllerSample | null;
  samples: ControllerSample[];
}) {
  const normalized = latestSample?.sticks[stick];
  const raw = latestSample?.rawSticks[stick];
  const points = samples
    .slice(-TRAIL_SAMPLES)
    .flatMap((sample) => (sample.sticks[stick] ? [sample.sticks[stick]] : []));
  const path = points
    .map((point, index) => {
      const plotted = plotPoint(point);
      return `${index === 0 ? 'M' : 'L'} ${plotted.x} ${plotted.y}`;
    })
    .join(' ');
  const current = normalized ? plotPoint(normalized) : null;
  const title = `${capitalize(stick)} stick`;

  return (
    <article className="joystick-monitor">
      <div className="joystick-monitor-heading">
        <h3>{title}</h3>
      </div>

      <div className="joystick-monitor-body">
        <svg
          className="joystick-plot"
          viewBox="0 0 180 180"
          role="img"
          aria-label={`${title} live position and recent movement trail`}
        >
          <circle className="joystick-boundary" cx="90" cy="90" r="66" />
          <circle className="joystick-guide" cx="90" cy="90" r="44" />
          <circle className="joystick-guide" cx="90" cy="90" r="22" />
          <path className="joystick-axis" d="M24 90h132M90 24v132" />
          <circle className="joystick-deadzone" cx="90" cy="90" r="7" />
          {path && <path className="joystick-trace" d={path} />}
          {current && (
            <>
              <path
                className="joystick-vector"
                d={`M${PLOT_CENTER} ${PLOT_CENTER}L${current.x} ${current.y}`}
              />
              <circle className="joystick-point" cx={current.x} cy={current.y} r="6" />
            </>
          )}
          <text x="162" y="86" textAnchor="end">
            +X
          </text>
          <text x="95" y="20">
            +Y
          </text>
        </svg>

        <dl className="joystick-values">
          <Value label="X" value={normalized ? signed(normalized.x) : 'N/A'} />
          <Value label="Y" value={normalized ? signed(normalized.y) : 'N/A'} />
          <Value label="Raw X" value={raw ? String(Math.round(raw.x)) : 'N/A'} />
          <Value label="Raw Y" value={raw ? String(Math.round(raw.y)) : 'N/A'} />
        </dl>
      </div>
    </article>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <output aria-label={`${label} ${value}`}>{value}</output>
      </dd>
    </div>
  );
}

function plotPoint(point: Vector2) {
  const magnitude = Math.hypot(point.x, point.y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return {
    x: PLOT_CENTER + point.x * scale * PLOT_RADIUS,
    y: PLOT_CENTER - point.y * scale * PLOT_RADIUS,
  };
}

function signed(value: number) {
  if (Math.abs(value) < 0.0005) return '0.000';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
