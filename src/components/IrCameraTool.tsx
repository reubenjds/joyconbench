import { useEffect, useRef, useState } from 'react';
import type {
  ControllerIdentity,
  IrCameraCapability,
  IrFrame,
  IrStreamStats,
} from '../types/controller';
import { Button, Panel } from './ui';

type StreamState = 'idle' | 'starting' | 'streaming' | 'stopping' | 'error';
type CheckPhase =
  'idle' | 'uncovered' | 'cover-ready' | 'covered' | 'pass' | 'retry' | 'inconclusive';

const EMPTY_STATS: IrStreamStats = {
  receivedPackets: 0,
  completedFrames: 0,
  droppedFragments: 0,
  malformedPackets: 0,
  framesPerSecond: 0,
  lastFrameAt: null,
};

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
  const animationFrame = useRef(0);
  const checkTimer = useRef(0);
  const phaseRef = useRef<CheckPhase>('idle');
  const phaseSamples = useRef<number[]>([]);
  const uncoveredLevel = useRef<number | null>(null);
  const streamStartedAt = useRef(0);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [stats, setStats] = useState<IrStreamStats>(EMPTY_STATS);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [phase, setPhase] = useState<CheckPhase>('idle');
  const [message, setMessage] = useState('Start the camera to inspect its live response.');
  const [copiedLog, setCopiedLog] = useState(false);

  const setCheckPhase = (next: CheckPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    if (!capability) return;
    const unsubscribe = capability.subscribe((frame, nextStats) => {
      const level = meanLuminance(frame.pixels);
      setBrightness(level);
      setStats(nextStats);
      if (phaseRef.current === 'uncovered' || phaseRef.current === 'covered') {
        phaseSamples.current.push(level);
      }
      pendingFrame.current = frame;
      if (!animationFrame.current) {
        animationFrame.current = window.requestAnimationFrame(() => {
          animationFrame.current = 0;
          if (pendingFrame.current) drawFrame(canvas.current, pendingFrame.current);
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
    setStats(EMPTY_STATS);
    setBrightness(null);
    setCheckPhase('idle');
    clearCanvas(canvas.current);
    try {
      await capability.start();
      streamStartedAt.current = performance.now();
      setStreamState('streaming');
      setMessage('Streaming. Point the black IR window toward a nearby object.');
    } catch (error) {
      setStreamState('error');
      setMessage(error instanceof Error ? error.message : 'The IR camera could not start.');
    }
  };

  const copyDiagnostics = async () => {
    if (!capability) return;
    const log = capability.diagnostics().join('\n');
    try {
      await navigator.clipboard.writeText(log);
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

  const busy = streamState === 'starting' || streamState === 'stopping';
  const streaming = streamState === 'streaming';

  return (
    <div className="ir-workspace">
      <Panel className="ir-viewer">
        <div className="ir-viewer-heading">
          <div>
            <span className="sticker">Live grayscale</span>
            <h2>IR camera</h2>
          </div>
          <div className={`ir-stream-state ir-stream-state-${streamState}`} role="status">
            <span aria-hidden="true" />
            {streamLabel(streamState)}
          </div>
        </div>
        <div className="ir-canvas-frame">
          <canvas ref={canvas} width="80" height="60" aria-label="Live infrared camera image" />
          {!streaming && (
            <p>{streamState === 'starting' ? 'Starting camera…' : 'Camera stopped'}</p>
          )}
        </div>
        <div className="ir-metrics" aria-label="IR stream measurements">
          <Metric label="Resolution" value="80 × 60" />
          <Metric
            label="Frame rate"
            value={stats.completedFrames ? `${stats.framesPerSecond.toFixed(1)} fps` : 'Waiting'}
          />
          <Metric label="Complete frames" value={String(stats.completedFrames)} />
          <Metric label="Dropped fragments" value={String(stats.droppedFragments)} />
          <Metric
            label="Brightness"
            value={brightness === null ? 'Waiting' : `${Math.round(brightness)} / 255`}
          />
        </div>
        <div className="tool-actions">
          {!streaming ? (
            <Button onClick={startCamera} disabled={busy}>
              {streamState === 'starting' ? 'Starting…' : 'Start camera'}
            </Button>
          ) : (
            <Button className="button-secondary" onClick={() => void stopCamera()}>
              Stop camera
            </Button>
          )}
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
            <Button onClick={beginUncoveredCheck} disabled={!streaming}>
              {phase === 'idle' ? 'Run camera check' : 'Run check again'}
            </Button>
          )}
          {phase === 'cover-ready' && <Button onClick={beginCoveredCheck}>I’m covering it</Button>}
          {(phase === 'uncovered' || phase === 'covered') && <Button disabled>Measuring…</Button>}
        </div>
        <p className="tool-fine-print">
          A passing check requires at least five complete frames in each stage and a brightness
          increase of 12 or more on the 0–255 grayscale range.
        </p>
      </Panel>
    </div>
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

function drawFrame(canvas: HTMLCanvasElement | null, frame: IrFrame) {
  const context = canvas?.getContext('2d');
  if (!context) return;
  const image = context.createImageData(frame.width, frame.height);
  for (let index = 0; index < frame.pixels.length; index += 1) {
    const value = frame.pixels[index];
    const target = index * 4;
    image.data[target] = value;
    image.data[target + 1] = value;
    image.data[target + 2] = value;
    image.data[target + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  canvas?.getContext('2d')?.clearRect(0, 0, 80, 60);
}

function meanLuminance(pixels: Uint8Array) {
  return pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function streamLabel(state: StreamState) {
  if (state === 'starting') return 'Starting';
  if (state === 'streaming') return 'Streaming';
  if (state === 'stopping') return 'Stopping';
  if (state === 'error') return 'Needs attention';
  return 'Stopped';
}
