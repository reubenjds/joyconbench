import { useEffect, useRef, useState } from 'react';
import { DEFAULT_IR_SETTINGS, IR_RESOLUTION_MODES } from '../protocol/ir';
import type {
  ControllerIdentity,
  IrCameraCapability,
  IrCameraSettings,
  IrFrame,
  IrResolution,
  IrStreamStats,
} from '../types/controller';
import { Button, Panel } from './ui';

type StreamState = 'idle' | 'starting' | 'streaming' | 'stopping' | 'configuring' | 'error';
type CheckPhase =
  'idle' | 'uncovered' | 'cover-ready' | 'covered' | 'pass' | 'retry' | 'inconclusive';
type IrPalette = 'grayscale' | 'night' | 'infrared' | 'ironbow' | 'viridis' | 'plasma' | 'amber';

const EMPTY_STATS: IrStreamStats = {
  receivedPackets: 0,
  completedFrames: 0,
  droppedFragments: 0,
  malformedPackets: 0,
  framesPerSecond: 0,
  lastFrameAt: null,
  averageIntensity: null,
  whitePixels: 0,
  whitePixelsPercent: 0,
  ambientNoisePixels: 0,
  ambientNoiseRatio: 0,
  externalFilterIntensity: 0,
  exposureMicroseconds: DEFAULT_IR_SETTINGS.exposureMicroseconds,
};

const RESOLUTIONS = Object.keys(IR_RESOLUTION_MODES) as IrResolution[];
const PALETTES: { id: IrPalette; label: string }[] = [
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'night', label: 'Night vision' },
  { id: 'infrared', label: 'Infrared red' },
  { id: 'ironbow', label: 'Ironbow' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'plasma', label: 'Plasma' },
  { id: 'amber', label: 'Amber' },
];
const CHECK_DURATION_MS = 2000;
const MINIMUM_CHECK_FRAMES = 5;
const MINIMUM_LUMINANCE_CHANGE = 12;

export function IrCameraTool({
  identity,
  capability,
  preview,
}: {
  identity: ControllerIdentity;
  capability?: IrCameraCapability;
  preview: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pendingFrame = useRef<IrFrame | null>(null);
  const latestFrame = useRef<IrFrame | null>(null);
  const animationFrame = useRef(0);
  const checkTimer = useRef(0);
  const phaseRef = useRef<CheckPhase>('idle');
  const phaseSamples = useRef<number[]>([]);
  const uncoveredLevel = useRef<number | null>(null);
  const streamStartedAt = useRef(0);
  const paletteRef = useRef<IrPalette>('grayscale');
  const enhanceContrastRef = useRef(false);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [stats, setStats] = useState<IrStreamStats>(EMPTY_STATS);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [phase, setPhase] = useState<CheckPhase>('idle');
  const [message, setMessage] = useState('Start the camera to inspect its live response.');
  const [copiedLog, setCopiedLog] = useState(false);
  const [palette, setPalette] = useState<IrPalette>('grayscale');
  const [enhanceContrast, setEnhanceContrast] = useState(false);
  const [settings, setSettings] = useState<IrCameraSettings>(() =>
    capability ? capability.settings() : { ...DEFAULT_IR_SETTINGS }
  );

  const setCheckPhase = (next: CheckPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    paletteRef.current = palette;
    enhanceContrastRef.current = enhanceContrast;
    if (latestFrame.current)
      drawFrame(canvas.current, latestFrame.current, palette, enhanceContrast);
  }, [palette, enhanceContrast]);

  useEffect(() => {
    if (!capability) return;
    const unsubscribe = capability.subscribe((frame, nextStats) => {
      const level = meanLuminance(frame.pixels);
      setBrightness(level);
      setStats(nextStats);
      if (phaseRef.current === 'uncovered' || phaseRef.current === 'covered') {
        phaseSamples.current.push(level);
      }
      latestFrame.current = frame;
      pendingFrame.current = frame;
      if (!animationFrame.current) {
        animationFrame.current = window.requestAnimationFrame(() => {
          animationFrame.current = 0;
          if (pendingFrame.current) {
            drawFrame(
              canvas.current,
              pendingFrame.current,
              paletteRef.current,
              enhanceContrastRef.current
            );
          }
        });
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(checkTimer.current);
      window.cancelAnimationFrame(animationFrame.current);
      void capability.stop();
    };
  }, [capability]);

  useEffect(() => {
    if (!capability) return;
    const stopWhenHidden = () => {
      if (document.visibilityState !== 'hidden' || streamState !== 'streaming') return;
      window.clearTimeout(checkTimer.current);
      setCheckPhase('idle');
      setStreamState('stopping');
      setMessage('Stopping the camera and restoring normal controller input…');
      void capability.stop().then(() => {
        setStreamState('idle');
        setMessage('The camera stopped when this tab moved to the background.');
      });
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => document.removeEventListener('visibilitychange', stopWhenHidden);
  }, [capability, streamState]);

  useEffect(() => {
    if (!capability || streamState !== 'streaming') return;
    const watchdog = window.setInterval(() => {
      const latestActivity = stats.lastFrameAt ?? streamStartedAt.current;
      if (performance.now() - latestActivity <= 8000) return;
      setStreamState('error');
      setCheckPhase('inconclusive');
      setMessage('No complete IR frame arrived for eight seconds. Stop and retry the camera.');
      void capability.stop();
    }, 1000);
    return () => window.clearInterval(watchdog);
  }, [capability, stats.lastFrameAt, streamState]);

  const startCamera = async () => {
    if (!capability) return;
    setStreamState('starting');
    setMessage('Starting the Joy-Con IR processor…');
    setStats({ ...EMPTY_STATS, exposureMicroseconds: settings.exposureMicroseconds });
    setBrightness(null);
    setCheckPhase('idle');
    latestFrame.current = null;
    clearCanvas(canvas.current);
    try {
      await capability.start(settings);
      streamStartedAt.current = performance.now();
      setStreamState('streaming');
      setMessage('Streaming. Point the black IR window toward a nearby object.');
    } catch (error) {
      setStreamState('error');
      setMessage(error instanceof Error ? error.message : 'The IR camera could not start.');
    }
  };

  const applySettings = async () => {
    if (!capability) return;
    if (streamState !== 'streaming') {
      await capability.configure(settings);
      setMessage('Settings saved. They will be used when the camera starts.');
      return;
    }
    setStreamState('configuring');
    setMessage('Applying camera settings…');
    try {
      await capability.configure(settings);
      streamStartedAt.current = performance.now();
      setStreamState('streaming');
      setMessage('Settings applied. The live stream has resumed.');
    } catch (error) {
      setStreamState('error');
      setMessage(error instanceof Error ? error.message : 'The IR settings could not be applied.');
    }
  };

  const copyDiagnostics = async () => {
    if (!capability) return;
    try {
      await navigator.clipboard.writeText(capability.diagnostics().join('\n'));
      setCopiedLog(true);
      window.setTimeout(() => setCopiedLog(false), 4000);
    } catch {
      setMessage('The log could not be copied. Check this page has clipboard permission.');
    }
  };

  const stopCamera = async (stoppedMessage = 'The camera is stopped.') => {
    if (!capability) return;
    window.clearTimeout(checkTimer.current);
    setCheckPhase('idle');
    setStreamState('stopping');
    setMessage('Stopping the camera and restoring normal controller input…');
    await capability.stop();
    setStreamState('idle');
    setMessage(stoppedMessage);
  };

  const saveSnapshot = () => {
    const source = canvas.current;
    if (!source || !latestFrame.current) return;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = latestFrame.current.width;
    exportCanvas.height = latestFrame.current.height;
    const context = exportCanvas.getContext('2d');
    if (!context) return;
    context.drawImage(source, 0, 0, exportCanvas.width, exportCanvas.height);
    const link = document.createElement('a');
    link.download = `joycon-ir-${latestFrame.current.width}x${latestFrame.current.height}-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  const beginUncoveredCheck = () => {
    phaseSamples.current = [];
    uncoveredLevel.current = null;
    setCheckPhase('uncovered');
    setMessage('Keep the IR window uncovered and aimed at the same nearby object.');
    checkTimer.current = window.setTimeout(() => {
      if (phaseSamples.current.length < MINIMUM_CHECK_FRAMES) {
        setCheckPhase('inconclusive');
        setMessage('Not enough complete frames arrived. Keep the Joy-Con close and try again.');
        return;
      }
      uncoveredLevel.current = median(phaseSamples.current);
      phaseSamples.current = [];
      setCheckPhase('cover-ready');
      setMessage('Now cover the black IR window completely with your hand.');
    }, CHECK_DURATION_MS);
  };

  const beginCoveredCheck = () => {
    phaseSamples.current = [];
    setCheckPhase('covered');
    setMessage('Keep the IR window covered while the camera response is measured.');
    checkTimer.current = window.setTimeout(() => {
      const baseline = uncoveredLevel.current;
      if (baseline === null || phaseSamples.current.length < MINIMUM_CHECK_FRAMES) {
        setCheckPhase('inconclusive');
        setMessage('Not enough complete frames arrived during the covered measurement.');
        return;
      }
      const covered = median(phaseSamples.current);
      if (covered - baseline >= MINIMUM_LUMINANCE_CHANGE) {
        setCheckPhase('pass');
        setMessage('The camera reacted clearly when its IR window was covered.');
      } else {
        setCheckPhase('retry');
        setMessage('The image changed too little. Uncover the window and run the check again.');
      }
    }, CHECK_DURATION_MS);
  };

  if (preview || identity.kind !== 'joycon-right' || !capability) {
    return (
      <Panel className="ir-unavailable color-red">
        <span className="sticker">IR camera</span>
        <h2>A right Joy-Con is required</h2>
        <p>
          {preview
            ? 'The local preview does not create camera data. Connect a physical original right Joy-Con to use this tool.'
            : 'The infrared camera is built into the black rail on an original right Joy-Con. The connected left Joy-Con does not contain this sensor.'}
        </p>
      </Panel>
    );
  }

  const busy = ['starting', 'stopping', 'configuring'].includes(streamState);
  const streaming = streamState === 'streaming' || streamState === 'configuring';
  const mode = IR_RESOLUTION_MODES[settings.resolution];
  const displayedWidth = latestFrame.current?.width ?? mode.width;
  const displayedHeight = latestFrame.current?.height ?? mode.height;

  return (
    <div className="ir-workspace">
      <Panel className="ir-viewer">
        <div className="ir-viewer-heading">
          <div>
            <span className="sticker">Live near-infrared</span>
            <h2>IR camera</h2>
          </div>
          <div className={`ir-stream-state ir-stream-state-${streamState}`} role="status">
            <span aria-hidden="true" />
            {streamLabel(streamState)}
          </div>
        </div>
        <div className="ir-canvas-frame">
          <canvas
            ref={canvas}
            width={mode.width}
            height={mode.height}
            aria-label="Live infrared camera image"
          />
          {!streaming && (
            <p>{streamState === 'starting' ? 'Starting camera…' : 'Camera stopped'}</p>
          )}
        </div>
        <dl className="ir-metrics" aria-label="IR stream measurements">
          <Metric label="Resolution" value={`${displayedWidth} × ${displayedHeight}`} />
          <Metric
            label="Frame rate"
            value={stats.completedFrames ? `${stats.framesPerSecond.toFixed(1)} fps` : 'Waiting'}
          />
          <Metric label="Intensity" value={metric255(stats.averageIntensity)} />
          <Metric
            label="Brightness"
            value={brightness === null ? 'Waiting' : `${Math.round(brightness)} / 255`}
          />
          <Metric label="White pixels" value={`${stats.whitePixelsPercent.toFixed(1)}%`} />
          <Metric label="Ambient noise" value={stats.ambientNoiseRatio.toFixed(2)} />
          <Metric label="Exposure" value={`${stats.exposureMicroseconds} µs`} />
          <Metric label="Complete frames" value={String(stats.completedFrames)} />
          <Metric label="Dropped fragments" value={String(stats.droppedFragments)} />
        </dl>
        <div className="tool-actions">
          {!streaming ? (
            <Button onClick={startCamera} disabled={busy}>
              {streamState === 'starting' ? 'Starting…' : 'Start camera'}
            </Button>
          ) : (
            <Button className="button-secondary" onClick={() => void stopCamera()} disabled={busy}>
              Stop camera
            </Button>
          )}
          <Button
            className="button-secondary"
            onClick={saveSnapshot}
            disabled={!latestFrame.current}
          >
            Save PNG
          </Button>
          {streamState === 'error' && (
            <Button className="button-secondary" onClick={copyDiagnostics}>
              {copiedLog ? 'Log copied' : 'Copy start-up log'}
            </Button>
          )}
        </div>
        {streamState === 'error' && (
          <p className="tool-fine-print">
            The start-up log lists each handshake stage and the last reply the Joy-Con sent. It
            contains no controller identifiers.
          </p>
        )}
      </Panel>

      <Panel className="ir-controls-panel">
        <span className="sticker">Sensor controls</span>
        <h2>Capture settings</h2>

        <ControlGroup legend="Image">
          <label>
            <span>Resolution</span>
            <select
              value={settings.resolution}
              onChange={(event) => {
                const resolution = event.target.value as IrResolution;
                setSettings({
                  ...settings,
                  resolution,
                  autoExposure: resolution === '40x30' ? false : settings.autoExposure,
                });
              }}
            >
              {RESOLUTIONS.map((resolution) => (
                <option key={resolution} value={resolution}>
                  {IR_RESOLUTION_MODES[resolution].width} × {IR_RESOLUTION_MODES[resolution].height}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Colour scale</span>
            <select
              value={palette}
              onChange={(event) => setPalette(event.target.value as IrPalette)}
            >
              {PALETTES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Toggle
            label="Auto contrast preview"
            checked={enhanceContrast}
            onChange={setEnhanceContrast}
          />
          <Toggle
            label="Mirror sensor image"
            checked={settings.horizontalFlip}
            onChange={(checked) => setSettings({ ...settings, horizontalFlip: checked })}
          />
        </ControlGroup>

        <ControlGroup legend="Exposure">
          <Toggle
            label="Auto exposure"
            checked={settings.autoExposure}
            disabled={settings.resolution === '40x30'}
            onChange={(checked) => setSettings({ ...settings, autoExposure: checked })}
          />
          <RangeControl
            label="Exposure"
            value={settings.exposureMicroseconds}
            minimum={0}
            maximum={600}
            unit="µs"
            disabled={settings.autoExposure}
            onChange={(value) => setSettings({ ...settings, exposureMicroseconds: value })}
          />
          <RangeControl
            label="Digital gain"
            value={settings.digitalGain}
            minimum={1}
            maximum={20}
            unit="×"
            disabled={settings.autoExposure}
            onChange={(value) => setSettings({ ...settings, digitalGain: value })}
          />
          <Toggle
            label="External-light filter"
            checked={settings.externalLightFilter}
            disabled={settings.flashlight}
            onChange={(checked) => setSettings({ ...settings, externalLightFilter: checked })}
          />
        </ControlGroup>

        <ControlGroup legend="IR illumination">
          <Toggle
            label="Far / narrow LEDs (75°)"
            checked={settings.farLedEnabled}
            onChange={(checked) => setSettings({ ...settings, farLedEnabled: checked })}
          />
          <RangeControl
            label="Far LED power"
            value={settings.farLedIntensity}
            minimum={0}
            maximum={15}
            disabled={!settings.farLedEnabled || settings.flashlight}
            onChange={(value) => setSettings({ ...settings, farLedIntensity: value })}
          />
          <Toggle
            label="Near / wide LEDs (130°)"
            checked={settings.nearLedEnabled}
            onChange={(checked) => setSettings({ ...settings, nearLedEnabled: checked })}
          />
          <RangeControl
            label="Near LED power"
            value={settings.nearLedIntensity}
            minimum={0}
            maximum={16}
            disabled={!settings.nearLedEnabled || settings.flashlight}
            onChange={(value) => setSettings({ ...settings, nearLedIntensity: value })}
          />
          <Toggle
            label="Flashlight mode"
            checked={settings.flashlight}
            onChange={(checked) =>
              setSettings({
                ...settings,
                flashlight: checked,
                strobe: checked ? false : settings.strobe,
              })
            }
          />
          <Toggle
            label="Strobe mode"
            checked={settings.strobe}
            disabled={settings.flashlight}
            onChange={(checked) => setSettings({ ...settings, strobe: checked })}
          />
        </ControlGroup>

        <ControlGroup legend="Sensor processing">
          <Toggle
            label="Denoise"
            checked={settings.denoiseEnabled}
            onChange={(checked) => setSettings({ ...settings, denoiseEnabled: checked })}
          />
          <RangeControl
            label="Edge smoothing"
            value={settings.denoiseEdgeSmoothing}
            minimum={0}
            maximum={255}
            disabled={!settings.denoiseEnabled}
            onChange={(value) => setSettings({ ...settings, denoiseEdgeSmoothing: value })}
          />
          <RangeControl
            label="Interpolation threshold"
            value={settings.denoiseColorInterpolation}
            minimum={0}
            maximum={255}
            disabled={!settings.denoiseEnabled}
            onChange={(value) => setSettings({ ...settings, denoiseColorInterpolation: value })}
          />
        </ControlGroup>

        <Button onClick={() => void applySettings()} disabled={busy}>
          {streamState === 'configuring' ? 'Applying…' : streaming ? 'Apply live' : 'Use settings'}
        </Button>
        <p className="tool-fine-print">
          Higher resolutions contain more fragments and update more slowly over Bluetooth. Auto
          exposure is unavailable at 40 × 30, matching the sensor’s timing limit.
        </p>
      </Panel>

      <Panel className="ir-check-panel color-red">
        <span className="sticker">Camera response</span>
        <h2>Cover check</h2>
        <p className="ir-check-intro">
          Compare the camera’s brightness before and after covering its black window. This checks
          whether complete images arrive and the sensor reacts.
        </p>
        <ol className="ir-check-steps">
          <CheckStep
            number="01"
            label="Leave the IR window uncovered"
            active={phase === 'uncovered'}
            complete={!['idle', 'uncovered'].includes(phase)}
          />
          <CheckStep
            number="02"
            label="Cover the IR window completely"
            active={phase === 'cover-ready' || phase === 'covered'}
            complete={phase === 'pass' || phase === 'retry'}
          />
        </ol>
        <div
          className={`ir-check-message ir-check-message-${phase}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
        <div className="tool-actions">
          {(phase === 'idle' ||
            phase === 'pass' ||
            phase === 'retry' ||
            phase === 'inconclusive') && (
            <Button onClick={beginUncoveredCheck} disabled={!streaming || busy}>
              {phase === 'idle' ? 'Run camera check' : 'Run check again'}
            </Button>
          )}
          {phase === 'cover-ready' && <Button onClick={beginCoveredCheck}>I’m covering it</Button>}
          {(phase === 'uncovered' || phase === 'covered') && <Button disabled>Measuring…</Button>}
        </div>
        <p className="tool-fine-print">
          A passing check requires at least five complete frames in each stage and a brightness
          increase of 12 or more on the 0–255 sensor range.
        </p>
      </Panel>
    </div>
  );
}

function ControlGroup({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="ir-control-group">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="ir-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  unit = '',
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ir-range-control">
      <span>{label}</span>
      <output>{unit === '×' ? `${value}${unit}` : `${value}${unit ? ` ${unit}` : ''}`}</output>
      <input
        type="range"
        min={minimum}
        max={maximum}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CheckStep({
  number,
  label,
  active,
  complete,
}: {
  number: string;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <li className={`${active ? 'active' : ''} ${complete ? 'complete' : ''}`.trim()}>
      <strong>{number}</strong>
      <span>{label}</span>
    </li>
  );
}

function drawFrame(
  canvas: HTMLCanvasElement | null,
  frame: IrFrame,
  palette: IrPalette,
  enhanceContrast: boolean
) {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const image = context.createImageData(frame.width, frame.height);
  const [minimum, maximum] = enhanceContrast ? percentileRange(frame.pixels) : [0, 255];
  for (let index = 0; index < frame.pixels.length; index += 1) {
    const value = scaleByte(frame.pixels[index], minimum, maximum);
    const [red, green, blue] = paletteColor(palette, value);
    const target = index * 4;
    image.data[target] = red;
    image.data[target + 1] = green;
    image.data[target + 2] = blue;
    image.data[target + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function paletteColor(palette: IrPalette, value: number): readonly [number, number, number] {
  if (palette === 'grayscale') return [value, value, value];
  if (palette === 'night') return [0, value, Math.round(value * 0.18)];
  if (palette === 'infrared') return [value, 0, 0];
  if (palette === 'amber') return [value, Math.round(value * 0.58), 0];
  if (palette === 'ironbow') {
    return gradient(value, [
      [0, 0, 0],
      [55, 0, 90],
      [180, 25, 35],
      [255, 145, 0],
      [255, 255, 230],
    ]);
  }
  if (palette === 'viridis') {
    return gradient(value, [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ]);
  }
  return gradient(value, [
    [13, 8, 135],
    [126, 3, 168],
    [204, 71, 120],
    [248, 149, 64],
    [240, 249, 33],
  ]);
}

function gradient(value: number, stops: readonly (readonly [number, number, number])[]) {
  const scaled = (value / 255) * (stops.length - 1);
  const left = Math.min(stops.length - 2, Math.floor(scaled));
  const amount = scaled - left;
  return stops[left].map((channel, index) =>
    Math.round(channel + (stops[left + 1][index] - channel) * amount)
  ) as unknown as readonly [number, number, number];
}

function percentileRange(pixels: Uint8Array): readonly [number, number] {
  const histogram = new Uint32Array(256);
  for (const value of pixels) histogram[value] += 1;
  const lowerTarget = pixels.length * 0.02;
  const upperTarget = pixels.length * 0.98;
  let cumulative = 0;
  let minimum = 0;
  let maximum = 255;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= lowerTarget) {
      minimum = value;
      break;
    }
  }
  cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= upperTarget) {
      maximum = value;
      break;
    }
  }
  return maximum > minimum ? [minimum, maximum] : [0, 255];
}

function scaleByte(value: number, minimum: number, maximum: number) {
  return Math.round(Math.min(255, Math.max(0, ((value - minimum) * 255) / (maximum - minimum))));
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}

function meanLuminance(pixels: Uint8Array) {
  return pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function metric255(value: number | null) {
  return value === null ? 'Waiting' : `${value} / 255`;
}

function streamLabel(state: StreamState) {
  if (state === 'starting') return 'Starting';
  if (state === 'streaming') return 'Streaming';
  if (state === 'stopping') return 'Stopping';
  if (state === 'configuring') return 'Applying settings';
  if (state === 'error') return 'Needs attention';
  return 'Stopped';
}
