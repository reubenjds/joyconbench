import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ControllerIdentity,
  IrCameraCapability,
  IrFrameListener,
  IrStreamStats,
} from '../types/controller';
import { DEFAULT_IR_SETTINGS } from '../protocol/ir';
import { IrCameraTool } from './IrCameraTool';

const RIGHT_JOY_CON: ControllerIdentity = {
  kind: 'joycon-right',
  displayName: 'Right Joy-Con',
  vendorId: 0x057e,
  productId: 0x2007,
  connection: 'bluetooth',
};

class FakeIrCapability implements IrCameraCapability {
  readonly start = vi.fn(async () => undefined);
  readonly stop = vi.fn(async () => undefined);
  readonly configure = vi.fn(async () => undefined);
  readonly settings = vi.fn(() => ({ ...DEFAULT_IR_SETTINGS }));
  readonly diagnostics = vi.fn(() => ['+0ms input mode: acknowledged on attempt 1']);
  private readonly listeners = new Set<IrFrameListener>();
  private completedFrames = 0;

  subscribe(listener: IrFrameListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: number) {
    this.completedFrames += 1;
    const stats: IrStreamStats = {
      receivedPackets: this.completedFrames * 16,
      completedFrames: this.completedFrames,
      droppedFragments: 0,
      malformedPackets: 0,
      framesPerSecond: 3.5,
      lastFrameAt: performance.now(),
      averageIntensity: value,
      whitePixels: 0,
      whitePixelsPercent: 0,
      ambientNoisePixels: 0,
      ambientNoiseRatio: 0,
      externalFilterIntensity: 0,
      exposureMicroseconds: 300,
    };
    for (const listener of this.listeners) {
      listener(
        {
          timestamp: performance.now(),
          sequence: this.completedFrames - 1,
          width: 80,
          height: 60,
          pixels: new Uint8Array(80 * 60).fill(value),
        },
        stats
      );
    }
  }
}

describe('IR camera tool', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('does not fabricate IR data for a left Joy-Con or preview', () => {
    render(
      <IrCameraTool
        identity={{ ...RIGHT_JOY_CON, kind: 'joycon-left' }}
        capability={undefined}
        preview
      />
    );
    expect(
      screen.getByRole('heading', { name: 'A right Joy-Con is required' })
    ).toBeInTheDocument();
    expect(screen.getByText(/physical original right Joy-Con/i)).toBeInTheDocument();
  });

  it('runs a two-stage cover check using complete live frames', async () => {
    vi.useFakeTimers();
    const capability = new FakeIrCapability();
    render(<IrCameraTool identity={RIGHT_JOY_CON} capability={capability} preview={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await act(async () => Promise.resolve());
    expect(capability.start).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Run camera check' }));
    act(() => {
      for (let index = 0; index < 5; index += 1) capability.emit(30);
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: /covering it/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /covering it/i }));
    act(() => {
      for (let index = 0; index < 5; index += 1) capability.emit(80);
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/camera reacted clearly/i)).toBeInTheDocument();
  });

  it('offers extra palettes and applies sensor settings to a live stream', async () => {
    const capability = new FakeIrCapability();
    render(<IrCameraTool identity={RIGHT_JOY_CON} capability={capability} preview={false} />);

    fireEvent.change(screen.getByLabelText('Colour scale'), { target: { value: 'viridis' } });
    expect(screen.getByLabelText('Colour scale')).toHaveValue('viridis');
    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '160x120' } });

    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Apply live' }));
    await act(async () => Promise.resolve());

    expect(capability.start).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: '160x120' })
    );
    expect(capability.configure).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: '160x120' })
    );
  });
});
