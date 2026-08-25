import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureCountdown } from './CaptureCountdown';

describe('CaptureCountdown', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down from the test duration and settles at zero', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <CaptureCountdown durationMs={5000} running={false} complete={false} />
    );

    expect(screen.getByRole('timer')).toHaveAccessibleName('5 seconds remaining');
    expect(screen.getByText('seconds')).toBeVisible();
    expect(document.querySelector('.capture-ring-progress')).toHaveStyle({
      strokeDashoffset: '0',
    });

    rerender(<CaptureCountdown durationMs={5000} running complete={false} />);
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByRole('timer')).toHaveAccessibleName('4 seconds remaining');

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('1 second remaining');

    rerender(<CaptureCountdown durationMs={5000} running={false} complete />);
    expect(screen.getByRole('timer')).toHaveAccessibleName('0 seconds remaining');
    expect(screen.getByText('complete')).toBeVisible();
    expect(document.querySelector('.capture-ring-progress')).toHaveStyle({
      strokeDashoffset: '100',
    });
  });
});
