import type { ControllerSample, StickId } from '../types/controller';

export function LivePlot({
  samples,
  stick = 'left',
}: {
  samples: ControllerSample[];
  stick?: StickId;
}) {
  const points = samples
    .slice(-100)
    .flatMap((sample) => (sample.sticks[stick] ? [sample.sticks[stick]] : []));
  const path = points
    .map(
      (point, index) => `${index === 0 ? 'M' : 'L'} ${150 + point.x * 110} ${150 - point.y * 110}`
    )
    .join(' ');
  const latest = points.at(-1);
  return (
    <figure className="live-plot">
      <figcaption>
        <span>{stick} stick</span>
        <strong>
          {latest ? `${latest.x.toFixed(3)} / ${latest.y.toFixed(3)}` : 'Waiting for input'}
        </strong>
      </figcaption>
      <svg viewBox="0 0 300 300" role="img" aria-label={`${stick} stick live position plot`}>
        <circle className="plot-boundary" cx="150" cy="150" r="110" />
        <circle className="plot-neutral" cx="150" cy="150" r="12" />
        <path className="plot-axis" d="M40 150h220M150 40v220" />
        {path && <path className="plot-trace" d={path} />}
        {latest && (
          <circle
            className="plot-point"
            cx={150 + latest.x * 110}
            cy={150 - latest.y * 110}
            r="7"
          />
        )}
      </svg>
    </figure>
  );
}
