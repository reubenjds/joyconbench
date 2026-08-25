import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_BUTTONS, type ControllerSample } from '../types/controller';
import { LiveImu } from './LiveImu';

describe('LiveImu', () => {
  it('shows decoded gyroscope and accelerometer readings', () => {
    const sample: ControllerSample = {
      timestamp: 100,
      buttons: { ...EMPTY_BUTTONS },
      sticks: {},
      rawSticks: {},
      imuFrames: [
        frame(1),
        frame(2),
        {
          offsetMs: 10,
          gyroscope: { x: 12.25, y: -7.5, z: 3 },
          accelerometer: { x: 0.25, y: -0.5, z: 1 },
        },
      ],
      battery: { percentage: 100, charging: false },
      packetCounter: 1,
      connection: 'bluetooth',
    };

    render(<LiveImu samples={[sample]} />);

    expect(screen.getByRole('img', { name: /Live gyroscope X, Y, and Z axes/i })).toBeVisible();
    expect(screen.getByLabelText('Gyroscope X')).toHaveTextContent('12.25 °/s');
    expect(screen.getByLabelText('Gyroscope Y')).toHaveTextContent('-7.50 °/s');
    expect(screen.getByLabelText('Accelerometer Z')).toHaveTextContent('1.00 g');
    expect(screen.getByText('3 frames / report')).toBeVisible();
  });
});

function frame(offsetMs: number) {
  return {
    offsetMs,
    gyroscope: { x: 0, y: 0, z: 0 },
    accelerometer: { x: 0, y: 0, z: 1 },
  };
}
