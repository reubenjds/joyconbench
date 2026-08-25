import { useEffect, useState } from 'react';

const UPDATE_INTERVAL_MS = 100;

export function CaptureCountdown({
  durationMs,
  running,
  complete,
}: {
  durationMs: number;
  running: boolean;
  complete: boolean;
}) {
  const [remainingMs, setRemainingMs] = useState(complete ? 0 : durationMs);

  useEffect(() => {
    if (!running) {
      setRemainingMs(complete ? 0 : durationMs);
      return;
    }

    const endsAt = performance.now() + durationMs;
    const update = () => setRemainingMs(Math.max(0, endsAt - performance.now()));
    setRemainingMs(durationMs);
    const timer = window.setInterval(update, UPDATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [complete, durationMs, running]);

  const seconds = Math.ceil(remainingMs / 1000);
  const progress = durationMs > 0 ? (remainingMs / durationMs) * 100 : 0;
  const state = running ? 'running' : complete ? 'complete' : 'ready';
  const visibleLabel = complete
    ? 'complete'
    : running
      ? seconds === 1
        ? 'second left'
        : 'seconds left'
      : seconds === 1
        ? 'second'
        : 'seconds';

  return (
    <div className="capture-clock" data-state={state}>
      <svg className="capture-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="capture-ring-track" cx="60" cy="60" r="54" />
        <circle
          className="capture-ring-progress"
          cx="60"
          cy="60"
          r="54"
          pathLength="100"
          style={{ strokeDashoffset: 100 - progress }}
        />
      </svg>
      <output
        className="capture-clock-output"
        role="timer"
        aria-live={running ? 'polite' : 'off'}
        aria-atomic="true"
        aria-label={`${seconds} ${seconds === 1 ? 'second' : 'seconds'} remaining`}
      >
        <strong>{seconds}</strong>
        <span>{visibleLabel}</span>
      </output>
    </div>
  );
}
