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

  return (
    <div
      className="capture-clock"
      data-state={running ? 'running' : complete ? 'complete' : 'ready'}
    >
      <output
        className="capture-clock-output"
        role="timer"
        aria-live={running ? 'polite' : 'off'}
        aria-atomic="true"
        aria-label={`${seconds} ${seconds === 1 ? 'second' : 'seconds'} remaining`}
      >
        <strong>{seconds}</strong>
        <span>{seconds === 1 ? 'second left' : 'seconds left'}</span>
      </output>
      <div className="capture-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
