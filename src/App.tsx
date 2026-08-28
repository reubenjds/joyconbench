import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaptureCountdown } from './components/CaptureCountdown';
import { ControllerDiagram } from './components/ControllerDiagram';
import { ControllerTools } from './components/ControllerTools';
import { LiveImu } from './components/LiveImu';
import { LiveJoysticks } from './components/LiveJoysticks';
import { LivePlot } from './components/LivePlot';
import { Button, Modal, Panel, StatusLabel } from './components/ui';
import {
  analyzeMotion,
  analyzeNeutral,
  analyzePackets,
  analyzeRange,
  analyzeSnapback,
  analyzeStationaryImu,
  applyIssueConfirmation,
  createConfirmationResult,
  type ConfirmationState,
  type MotionCaptures,
} from './diagnostics/calculations';
import { useController } from './hooks/useController';
import { useDemoController } from './hooks/useDemoController';
import { buildReport, downloadReport, reportSummary } from './report/report';
import type {
  ControllerButton,
  ControllerColors,
  ControllerIdentity,
  ControllerSample,
  DiagnosticResult,
  StickId,
} from './types/controller';

type View = 'connect' | 'bench' | 'test' | 'outputs' | 'tools' | 'results' | 'report';
type CaptureTestId = 'drift' | 'range' | 'snapback' | 'stationary' | 'motion' | 'packets';

interface TestDefinition {
  id: CaptureTestId | 'outputs';
  number: string;
  title: string;
  short: string;
  description: string;
  duration: number;
  action: string;
  featured?: boolean;
}

const TESTS: TestDefinition[] = [
  {
    id: 'drift',
    number: '01',
    title: 'Stick drift',
    short: 'Neutral test',
    description: 'Measure neutral offset and jitter: the quickest check for unwanted movement.',
    duration: 5000,
    action: 'Run 5-second drift check',
    featured: true,
  },
  {
    id: 'range',
    number: '02',
    title: 'Circular range',
    short: 'Full travel',
    description: 'Trace at least two slow rotations to spot restricted or uneven stick travel.',
    duration: 12000,
    action: 'Capture three rotations',
  },
  {
    id: 'snapback',
    number: '03',
    title: 'Release & snapback',
    short: 'Return path',
    description: 'Release from four directions and inspect the return-to-center path.',
    duration: 8000,
    action: 'Capture stick releases',
  },
  {
    id: 'stationary',
    number: '04',
    title: 'Gyroscope at rest',
    short: 'Sensor noise',
    description: 'Read all three gyroscope axes and measure bias and noise while it stays still.',
    duration: 5000,
    action: 'Capture stationary gyro',
  },
  {
    id: 'motion',
    number: '05',
    title: 'Gyroscope axes',
    short: 'Axis response',
    description: 'Capture a separate guided rotation around X, Y, and Z.',
    duration: 4000,
    action: 'Capture X axis',
  },
  {
    id: 'packets',
    number: '06',
    title: 'Connection',
    short: 'Packet timing',
    description: 'Check report rate, delays, and packet-counter gaps for ten seconds.',
    duration: 10000,
    action: 'Measure packet stability',
  },
  {
    id: 'outputs',
    number: '07',
    title: 'Lights & rumble',
    short: 'Optional outputs',
    description: 'Optionally pulse one player LED and run a gentle 300 ms vibration.',
    duration: 0,
    action: 'Open output checks',
  },
];

const BUTTON_LABELS: Record<ControllerButton, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  up: 'D-pad up',
  down: 'D-pad down',
  left: 'D-pad left',
  right: 'D-pad right',
  l: 'L',
  zl: 'ZL',
  r: 'R',
  zr: 'ZR',
  minus: 'Minus',
  plus: 'Plus',
  leftStick: 'Left stick press',
  rightStick: 'Right stick press',
  home: 'Home',
  capture: 'Capture',
  slLeft: 'SL',
  srLeft: 'SR',
  slRight: 'SL',
  srRight: 'SR',
};

export default function App() {
  const hardwareController = useController();
  const demoController = useDemoController();
  const previewActive = demoController.identity !== null;
  const controller = previewActive ? demoController : hardwareController;
  const [view, setView] = useState<View>('connect');
  const [selectedTest, setSelectedTest] = useState<CaptureTestId | null>(null);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [seenButtons, setSeenButtons] = useState<Set<ControllerButton>>(new Set());
  const [running, setRunning] = useState(false);
  const [runComplete, setRunComplete] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [includeDeviceIds, setIncludeDeviceIds] = useState(false);
  const [copyState, setCopyState] = useState('Copy summary');
  const [motionStep, setMotionStep] = useState(0);
  const confirmationStatesRef = useRef(new Map<string, ConfirmationState>());
  const motionCapturesRef = useRef<Partial<MotionCaptures>>({});
  const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';

  const identity = controller.identity;
  const requiredButtons = identity ? applicableButtons(identity) : [];
  const activeSticks = identity ? sticksFor(identity) : [];
  const report = useMemo(
    () => (identity ? buildReport(identity, results, includeDeviceIds) : null),
    [identity, results, includeDeviceIds]
  );

  useEffect(() => {
    if (!identity || view === 'connect' || !controller.latestSample) return;
    const pressed = Object.entries(controller.latestSample.buttons)
      .filter(([, value]) => value)
      .map(([key]) => key as ControllerButton);
    if (pressed.length) setSeenButtons((previous) => new Set([...previous, ...pressed]));
  }, [controller.latestSample, identity, view]);

  useEffect(() => {
    if (previewActive || hardwareController.status !== 'disconnected') return;
    setView('connect');
    setSelectedTest(null);
    setRunning(false);
    setRunComplete(false);
  }, [hardwareController.status, previewActive]);

  useEffect(() => {
    confirmationStatesRef.current.clear();
    motionCapturesRef.current = {};
    setMotionStep(0);
    if (identity) {
      setResults([]);
      setSeenButtons(new Set());
    }
  }, [identity]);

  const addResults = (nextResults: DiagnosticResult[]) => {
    const confirmedResults = nextResults.map((result) => {
      const confirmed = applyIssueConfirmation(
        result,
        confirmationStatesRef.current.get(result.testId)
      );
      if (confirmed.state) confirmationStatesRef.current.set(result.testId, confirmed.state);
      else confirmationStatesRef.current.delete(result.testId);
      return confirmed.result;
    });
    setResults((previous) => {
      const ids = new Set(confirmedResults.map((result) => result.testId));
      return [...previous.filter((result) => !ids.has(result.testId)), ...confirmedResults];
    });
  };

  const connect = async () => {
    try {
      await controller.connect();
      setPairingOpen(false);
      setView('tools');
    } catch {
      // The hook exposes a safe user-facing error.
    }
  };

  const openPreview = async () => {
    await demoController.connect();
    setView('tools');
  };

  const chooseTest = (test: TestDefinition) => {
    if (test.id === 'outputs') {
      setView('outputs');
      return;
    }
    setSelectedTest(test.id);
    setRunComplete(false);
    if (test.id === 'motion') {
      motionCapturesRef.current = {};
      setMotionStep(0);
    }
    setView('test');
  };

  const runSelectedTest = async () => {
    if (!selectedTest) return;
    const definition = TESTS.find((test) => test.id === selectedTest)!;
    setRunning(true);
    setRunComplete(false);
    let pageStayedVisible = document.visibilityState === 'visible';
    const trackVisibility = () => {
      if (document.visibilityState !== 'visible') pageStayedVisible = false;
    };
    document.addEventListener('visibilitychange', trackVisibility);
    try {
      const samples = await controller.capture(definition.duration);
      if (selectedTest === 'motion') {
        const axis = (['x', 'y', 'z'] as const)[motionStep];
        motionCapturesRef.current[axis] = samples;
        if (motionStep < 2) {
          setMotionStep((step) => step + 1);
          return;
        }
        addResults([analyzeMotion(motionCapturesRef.current as MotionCaptures)]);
        motionCapturesRef.current = {};
        setMotionStep(0);
      } else {
        addResults(analyzeCapture(selectedTest, samples, activeSticks, pageStayedVisible));
      }
      setRunComplete(true);
    } finally {
      document.removeEventListener('visibilitychange', trackVisibility);
      setRunning(false);
    }
  };

  const saveButtonCheck = () => {
    const missed = requiredButtons.filter((button) => !seenButtons.has(button));
    addResults([
      {
        testId: 'buttons',
        title: 'Button response',
        status: missed.length ? 'check-again' : 'pass',
        measurements: {
          expectedButtons: requiredButtons.length,
          observedButtons: requiredButtons.length - missed.length,
          unobserved: missed.map((button) => BUTTON_LABELS[button]).join(', ') || 'None',
          ...(missed.length ? { findingCode: `unresponsive-${missed.sort().join('-')}` } : {}),
        },
        explanation: 'Each applicable button was checked for an input response.',
        interpretation: missed.length
          ? 'One or more buttons were not observed. Check them again before treating them as an issue.'
          : 'Every applicable button produced an input event.',
        recommendations: missed.length
          ? ['Retry this test.', 'Press each unobserved button deliberately.']
          : ['No action is suggested by this check.'],
      },
    ]);
    if (missed.length) setSeenButtons(new Set());
  };

  const startAgain = async () => {
    await controller.disconnect();
    setView('connect');
    setSelectedTest(null);
    setResults([]);
    setSeenButtons(new Set());
    setRunComplete(false);
    setRunning(false);
    setIncludeDeviceIds(false);
    confirmationStatesRef.current.clear();
    motionCapturesRef.current = {};
    setMotionStep(0);
  };

  const retryResult = (result: DiagnosticResult) => {
    setRunComplete(false);
    if (result.testId === 'buttons') {
      setSeenButtons(new Set());
      setView('bench');
      return;
    }
    if (result.testId === 'led' || result.testId === 'rumble') {
      setView('outputs');
      return;
    }
    const testId = captureTestForResult(result.testId);
    if (!testId) return;
    setSelectedTest(testId);
    if (testId === 'motion') {
      motionCapturesRef.current = {};
      setMotionStep(0);
    }
    setView('test');
  };

  const copySummary = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(reportSummary(report));
    setCopyState('Copied!');
    window.setTimeout(() => setCopyState('Copy summary'), 1500);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          className="brand"
          type="button"
          onClick={() => setView(identity ? 'tools' : 'connect')}
        >
          <span className="brand-icon" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>
            JoyCon<span>Bench</span>
          </span>
        </button>
        {identity && (
          <nav className="main-nav" aria-label="Controller workspaces">
            <button
              className={`workspace-tab colour-tab ${view === 'tools' ? 'active' : ''}`.trim()}
              onClick={() => setView('tools')}
              aria-current={view === 'tools' ? 'page' : undefined}
            >
              Colours
            </button>
            <button
              className={`workspace-tab test-tab ${
                view === 'bench' || view === 'test' || view === 'outputs' ? 'active' : ''
              }`.trim()}
              onClick={() => setView('bench')}
              aria-current={
                view === 'bench' || view === 'test' || view === 'outputs' ? 'page' : undefined
              }
            >
              Tests
            </button>
            <button
              className={`result-tab ${
                view === 'results' || view === 'report' ? 'active' : ''
              }`.trim()}
              onClick={() => setView('results')}
              aria-current={view === 'results' || view === 'report' ? 'page' : undefined}
            >
              Results <span>{results.length}</span>
            </button>
          </nav>
        )}
        <div className="header-actions">
          <Button className="button-text" onClick={() => setPrivacyOpen(true)}>
            Privacy
          </Button>
        </div>
      </header>

      <main className="workspace">
        {view === 'connect' && (
          <ConnectView
            supported={hardwareController.supported}
            status={hardwareController.status}
            error={hardwareController.error}
            onOpenPairing={() => setPairingOpen(true)}
            onPreview={import.meta.env.DEV ? openPreview : undefined}
          />
        )}

        {identity && view !== 'connect' && (
          <div className="device-strip">
            <span className="device-dot" aria-hidden="true" />
            <strong>{identity.displayName}</strong>
            <span>
              {previewActive
                ? 'Local preview data'
                : `${
                    controller.latestSample
                      ? formatBattery(controller.latestSample.battery)
                      : 'Reading battery'
                  } · ${identity.connection}`}
            </span>
            <Button className="button-text" onClick={startAgain}>
              Switch controller
            </Button>
          </div>
        )}

        {identity && view === 'bench' && (
          <BenchView
            identity={identity}
            latestSample={controller.latestSample}
            samples={controller.samplesRef.current}
            controllerColors={controller.colors}
            requiredButtons={requiredButtons}
            seenButtons={seenButtons}
            results={results}
            onClearButtons={() => setSeenButtons(new Set())}
            onSaveButtons={saveButtonCheck}
            onChooseTest={chooseTest}
            onResults={() => setView('results')}
          />
        )}

        {identity && view === 'test' && selectedTest && (
          <TestView
            test={TESTS.find((test) => test.id === selectedTest)!}
            sticks={activeSticks}
            samples={controller.samplesRef.current}
            result={resultForTest(selectedTest, results)}
            running={running}
            complete={runComplete}
            motionStep={motionStep}
            onRun={runSelectedTest}
            onBack={() => setView('bench')}
          />
        )}

        {identity && view === 'outputs' && (
          <OutputView
            adapter={controller.adapter}
            results={results}
            onResult={(result) => addResults([result])}
            onBack={() => setView('bench')}
          />
        )}

        {identity && view === 'tools' && (
          <PageFrame
            eyebrow="Colours & backup"
            title="Controller colours"
            lede="Read or change the body and buttons."
            className="tools-page-heading"
          >
            <ControllerTools
              adapter={controller.adapter}
              identity={identity}
              batteryCritical={
                controller.latestSample !== null && controller.latestSample.battery.percentage <= 25
              }
              initialColors={controller.colors}
              onColorsChange={controller.setColors}
            />
          </PageFrame>
        )}

        {identity && view === 'results' && (
          <PageFrame eyebrow="Your bench notes" title="Results so far">
            <ResultsView results={results} onRetry={retryResult} />
            <div className="page-actions no-print">
              <Button className="button-secondary" onClick={() => setView('bench')}>
                Run another test
              </Button>
              <Button onClick={() => setView('report')} disabled={!results.length}>
                Finish report
              </Button>
            </div>
          </PageFrame>
        )}

        {identity && view === 'report' && report && (
          <PageFrame eyebrow="Ready to share" title="Your report is finished">
            <ReportView
              report={report}
              includeDeviceIds={includeDeviceIds}
              onIncludeDeviceIds={setIncludeDeviceIds}
              onDownload={() => downloadReport(report)}
              onCopy={copySummary}
              copyState={copyState}
              onStartAgain={startAgain}
            />
          </PageFrame>
        )}

        {isDebug && identity && view !== 'connect' && (
          <ProtocolLab
            identity={identity}
            sampleCount={controller.samplesRef.current.length}
            latest={controller.latestSample}
          />
        )}
      </main>

      <footer>
        <span>JoyConBench {__APP_VERSION__}</span>
        <span>Not affiliated with Nintendo.</span>
        <a href="https://github.com/reubenjds/joyconbench">Source code</a>
      </footer>

      <Modal
        open={pairingOpen}
        title="Connect a controller"
        onClose={() => setPairingOpen(false)}
        className="pairing-modal"
      >
        <div className="pairing-content">
          <p className="pairing-intro">
            Pair the Joy-Con with your computer first, then give this browser access.
          </p>
          <ol className="pairing-steps">
            <li>
              <span>
                <strong>Prepare the Joy-Con.</strong> Detach it from the console and keep it close
                to your computer.
              </span>
            </li>
            <li>
              <span>
                <strong>Open Bluetooth settings.</strong> Turn Bluetooth on and start adding a new
                device.
              </span>
            </li>
            <li>
              <span>
                <strong>Enter pairing mode.</strong> Hold the small round <strong>SYNC</strong>{' '}
                button on the inner rail for at least one second, until the player LEDs start
                flashing.
              </span>
            </li>
            <li>
              <span>
                <strong>Pair it with the computer.</strong> Choose Joy-Con (L) or Joy-Con (R) from
                the nearby Bluetooth devices and wait for it to connect.
              </span>
            </li>
            <li>
              <span>
                <strong>Keep it awake.</strong> Return here. If no player LED is lit, press a button
                to wake it.
              </span>
            </li>
            <li>
              <span>
                <strong>Give JoyConBench access.</strong> Open the controller picker below and
                choose the same Joy-Con in the browser prompt.
              </span>
            </li>
          </ol>
          <Button
            className="pairing-action"
            onClick={connect}
            disabled={controller.status === 'connecting'}
            autoFocus
          >
            {controller.status === 'connecting' ? 'Connecting…' : 'Open controller picker'}
          </Button>
        </div>
      </Modal>

      <Modal open={privacyOpen} title="Private by design" onClose={() => setPrivacyOpen(false)}>
        <div className="privacy-copy">
          <p>Live samples stay in memory and are never sent to a server.</p>
          <p>
            Diagnostic reports exclude MAC addresses, serials, raw packets, sample streams, and
            calibration values.
          </p>
          <p>
            Colour and backup tools touch only documented colour, calibration, and parameter regions
            after explicit confirmation. Firmware, pairing, erase, patch, and unknown regions remain
            blocked.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function ConnectView({
  supported,
  status,
  error,
  onOpenPairing,
  onPreview,
}: {
  supported: boolean;
  status: string;
  error: string | null;
  onOpenPairing: () => void;
  onPreview?: () => void;
}) {
  return (
    <div className="connect-hero">
      <section className="hero-blue">
        <div className="browser-note">
          <strong>Runs in your browser</strong>
          <span>Nothing uploaded</span>
        </div>
        <h1 aria-label="Test your controller. Set its colours.">
          Test your controller.
          <br />
          Set its colours.
        </h1>
        <p>
          Connect a Joy-Con to inspect its inputs or change its body and button colours. Everything
          runs locally in your browser.
        </p>
        <div className="connect-actions">
          {supported && (
            <Button onClick={onOpenPairing} disabled={status === 'connecting'}>
              Connect controller
            </Button>
          )}
          {onPreview && (
            <Button className="button-secondary" onClick={onPreview}>
              Preview without controller
            </Button>
          )}
        </div>
        {!supported && (
          <div className="support-warning" role="alert">
            <strong>This browser cannot access WebHID.</strong>
            <p>
              Use desktop Chrome, Edge, or another compatible Chromium browser over HTTPS or
              localhost.
            </p>
          </div>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="hero-red" aria-label="How JoyConBench works">
        <div className="hero-controller-pair" aria-hidden="true">
          <ControllerDiagram kind="joycon-left" />
          <ControllerDiagram kind="joycon-right" />
        </div>
        <ol className="hero-benefits">
          <li>Test buttons, sticks, motion, and connection quality</li>
          <li>Read, preview, and write body and button colours</li>
          <li>Back up and restore documented controller settings</li>
        </ol>
      </section>
    </div>
  );
}

function BenchView({
  identity,
  latestSample,
  samples,
  controllerColors,
  requiredButtons,
  seenButtons,
  results,
  onClearButtons,
  onSaveButtons,
  onChooseTest,
  onResults,
}: {
  identity: ControllerIdentity;
  latestSample: ControllerSample | null;
  samples: ControllerSample[];
  controllerColors: ControllerColors | null;
  requiredButtons: ControllerButton[];
  seenButtons: Set<ControllerButton>;
  results: DiagnosticResult[];
  onClearButtons: () => void;
  onSaveButtons: () => void;
  onChooseTest: (test: TestDefinition) => void;
  onResults: () => void;
}) {
  const buttonResult = results.find((result) => result.testId === 'buttons');
  return (
    <>
      <div className="bench-title">
        <div>
          <span className="comic-kicker">Live input</span>
          <h1>Button test</h1>
        </div>
        <p>
          The controller drawing reacts live. This button check is always ready, with no timer or
          forced tour.
        </p>
      </div>
      <div className="button-bench">
        <Panel className="diagram-panel color-blue">
          <div className="controller-live-view">
            <ControllerDiagram
              kind={identity.kind}
              sample={latestSample}
              colors={controllerColors ?? undefined}
              showSideView
            />
            <LiveJoysticks
              latestSample={latestSample}
              samples={samples}
              sticks={sticksFor(identity)}
            />
          </div>
          <div className="seen-meter">
            <strong>
              {seenButtons.size}/{requiredButtons.length}
            </strong>
            <span>controls spotted</span>
          </div>
        </Panel>
        <Panel className="checklist-panel color-red">
          <div className="panel-heading">
            <div>
              <span className="sticker">Live check</span>
              <h2>Button checklist</h2>
            </div>
            {buttonResult && (
              <StatusLabel status={buttonResult.status}>
                {testOutcomeLabel(buttonResult.status)}
              </StatusLabel>
            )}
          </div>
          <p>
            Pressed controls flash when clicked. Clear the board whenever you want another pass.
          </p>
          <ul className="button-checklist">
            {requiredButtons.map((button) => (
              <li key={button} className={seenButtons.has(button) ? 'checked' : ''}>
                <span className="check-box" aria-hidden="true">
                  {seenButtons.has(button) ? '✓' : ''}
                </span>
                {BUTTON_LABELS[button]}
                <span className="sr-only">
                  {seenButtons.has(button) ? ' observed' : ' not observed'}
                </span>
              </li>
            ))}
          </ul>
          <div className="tool-actions">
            <Button className="button-secondary" onClick={onClearButtons}>
              Clear
            </Button>
            <Button onClick={onSaveButtons} disabled={seenButtons.size === 0}>
              Save button result
            </Button>
          </div>
        </Panel>
      </div>
      <section className="suite-section">
        <div className="section-heading">
          <div>
            <span className="comic-kicker">PICK YOUR TESTS</span>
            <h2>Test suite</h2>
          </div>
          <Button className="button-secondary" onClick={onResults} disabled={!results.length}>
            View {results.length} result{results.length === 1 ? '' : 's'}
          </Button>
        </div>
        <div className="test-card-grid">
          {TESTS.map((test) => {
            const savedResult = resultForTest(test.id, results);
            const done = savedResult !== undefined;
            return (
              <article key={test.id} className={`test-card ${test.featured ? 'featured' : ''}`}>
                <div className="test-number">{test.number}</div>
                <div className="test-copy">
                  <span>{test.short}</span>
                  <h3>{test.title}</h3>
                  <p>{test.description}</p>
                </div>
                {savedResult && (
                  <StatusLabel status={savedResult.status}>
                    {resultLabel(savedResult.status)}
                  </StatusLabel>
                )}
                <Button onClick={() => onChooseTest(test)}>
                  {done ? 'Run again' : test.featured ? 'Check drift now' : 'Choose test'}
                </Button>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function TestView({
  test,
  sticks,
  samples,
  result,
  running,
  complete,
  motionStep,
  onRun,
  onBack,
}: {
  test: TestDefinition;
  sticks: StickId[];
  samples: ControllerSample[];
  result?: DiagnosticResult;
  running: boolean;
  complete: boolean;
  motionStep: number;
  onRun: () => void;
  onBack: () => void;
}) {
  const isImuTest = test.id === 'stationary' || test.id === 'motion';
  const motionAxis = (['X', 'Y', 'Z'] as const)[motionStep];
  const instruction =
    test.id === 'motion'
      ? `Rotate the controller around its ${motionAxis} axis.`
      : instructionTitle(test.id);
  const action =
    test.id === 'motion'
      ? complete
        ? 'Run all axes again'
        : `Capture ${motionAxis} axis`
      : complete
        ? 'Run it again'
        : test.action;
  return (
    <PageFrame eyebrow={`Test ${test.number} · ${test.short}`} title={test.title}>
      <div className="capture-instruction">
        <CaptureCountdown durationMs={test.duration} running={running} complete={complete} />
        <div>
          <h2>{instruction}</h2>
          <p>{test.description}</p>
        </div>
        <Button onClick={onRun} disabled={running}>
          {running ? 'Capturing…' : action}
        </Button>
      </div>
      {complete && result && (
        <div className={`capture-result capture-result-${result.status}`} role="status">
          <div className="capture-result-heading">
            <div>
              <span className="capture-result-label">Test result</span>
              <strong>{testOutcomeLabel(result.status)}</strong>
            </div>
            <StatusLabel status={result.status}>{resultLabel(result.status)}</StatusLabel>
          </div>
          <p>{result.interpretation}</p>
          <p className="capture-result-next">Result saved. Run it again or choose another test.</p>
        </div>
      )}
      <div className={`live-field ${isImuTest ? 'imu-field' : ''}`.trim()}>
        {isImuTest ? (
          <LiveImu samples={samples} />
        ) : (
          sticks.map((stick) => <LivePlot key={stick} samples={samples} stick={stick} />)
        )}
      </div>
      <div className="page-actions">
        <Button className="button-secondary" onClick={onBack} disabled={running}>
          ← Back to test suite
        </Button>
      </div>
    </PageFrame>
  );
}

function OutputView({
  adapter,
  results,
  onResult,
  onBack,
}: {
  adapter: ReturnType<typeof useController>['adapter'];
  results: DiagnosticResult[];
  onResult: (result: DiagnosticResult) => void;
  onBack: () => void;
}) {
  const [tested, setTested] = useState<'led' | 'rumble' | null>(null);
  const runLed = async () => {
    await adapter.setPlayerLeds(0x10);
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    await adapter.setPlayerLeds(0x00);
    setTested('led');
  };
  const runRumble = async () => {
    await adapter.rumble(300);
    setTested('rumble');
  };
  const recordResult = (result: DiagnosticResult) => {
    onResult(result);
    setTested(null);
  };
  return (
    <PageFrame eyebrow="Optional output checks" title="Lights and rumble">
      <div className="output-grid">
        {(['led', 'rumble'] as const).map((test) => {
          const recorded = results.find((result) => result.testId === test);
          const done = recorded?.status === 'pass';
          const title = test === 'led' ? 'Player LED' : 'Rumble motor';
          return (
            <Panel key={test} className={test === 'led' ? 'color-blue' : 'color-red'}>
              <span className="sticker">Optional</span>
              <h2>{title}</h2>
              <p>
                {test === 'led'
                  ? 'Pulse the player lights once.'
                  : 'Vibrate gently for 300 milliseconds.'}
              </p>
              {!done && tested !== test && (
                <Button onClick={test === 'led' ? runLed : runRumble}>Run {test} test</Button>
              )}
              {!done && tested === test && (
                <div className="confirmation-row">
                  <strong>Did it work?</strong>
                  <Button
                    onClick={() => recordResult(createConfirmationResult(test, title, 'yes'))}
                  >
                    Yep!
                  </Button>
                  <Button
                    className="button-secondary"
                    onClick={() => recordResult(createConfirmationResult(test, title, 'no'))}
                  >
                    Nope
                  </Button>
                </div>
              )}
              {recorded && (
                <StatusLabel status={recorded.status}>
                  {testOutcomeLabel(recorded.status)}
                </StatusLabel>
              )}
            </Panel>
          );
        })}
      </div>
      <div className="page-actions">
        <Button className="button-secondary" onClick={onBack}>
          ← Back to test suite
        </Button>
      </div>
    </PageFrame>
  );
}

function ResultsView({
  results,
  onRetry,
}: {
  results: DiagnosticResult[];
  onRetry: (result: DiagnosticResult) => void;
}) {
  const issueCount = results.filter((result) => result.status === 'potential-issue').length;
  const checkAgainCount = results.filter((result) => result.status === 'check-again').length;
  if (!results.length)
    return (
      <Panel className="empty-results">
        <span className="comic-kicker">EMPTY BENCH</span>
        <h2>No saved tests yet.</h2>
        <p>Pick any test from the suite. Drift is a good place to start.</p>
      </Panel>
    );
  return (
    <div className="results-layout">
      <Panel className="result-summary">
        <p className="summary-number">{issueCount}</p>
        <div>
          <h2>{issueCount === 1 ? 'potential issue' : 'potential issues'}</h2>
          <p>
            Only findings repeated in two valid captures count as issues. {checkAgainCount} result
            {checkAgainCount === 1 ? '' : 's'} currently need another check.
          </p>
        </div>
      </Panel>
      <div className="result-list">
        {results.map((result) => (
          <Panel key={result.testId} className="result-card">
            <div className="result-heading">
              <h2>{result.title}</h2>
              <StatusLabel status={result.status}>{resultLabel(result.status)}</StatusLabel>
            </div>
            <dl className="measurements">
              {Object.entries(result.measurements).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
            <p>
              <strong>Measured:</strong> {result.explanation}
            </p>
            <p>
              <strong>Interpretation:</strong> {result.interpretation}
            </p>
            <ul>
              {result.recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {(result.status === 'check-again' ||
              result.status === 'inconclusive' ||
              result.status === 'potential-issue') && (
              <Button className="button-secondary no-print" onClick={() => onRetry(result)}>
                Retry test
              </Button>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}

function ReportView({
  report,
  includeDeviceIds,
  onIncludeDeviceIds,
  onDownload,
  onCopy,
  copyState,
  onStartAgain,
}: {
  report: ReturnType<typeof buildReport>;
  includeDeviceIds: boolean;
  onIncludeDeviceIds: (value: boolean) => void;
  onDownload: () => void;
  onCopy: () => void;
  copyState: string;
  onStartAgain: () => void;
}) {
  return (
    <>
      <div className="report-layout">
        <Panel className="report-privacy color-red">
          <span className="sticker">Privacy-safe</span>
          <h2>Share the measurements, not the controller.</h2>
          <ul>
            <li>No MAC address or serial</li>
            <li>No raw packets or sample streams</li>
            <li>No calibration values</li>
          </ul>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeDeviceIds}
              onChange={(event) => onIncludeDeviceIds(event.target.checked)}
            />
            Include non-unique vendor and product IDs
          </label>
        </Panel>
        <Panel className="report-preview">
          <div className="report-title">
            <span>JoyConBench</span>
            <strong>Diagnostic report</strong>
          </div>
          <pre>{reportSummary(report)}</pre>
          <div className="report-actions no-print">
            <Button onClick={onDownload}>Download JSON</Button>
            <Button className="button-secondary" onClick={onCopy}>
              {copyState}
            </Button>
            <Button className="button-text" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </Panel>
      </div>
      <div className="again-card no-print">
        <div>
          <span className="comic-kicker">Next controller</span>
          <h2>Testing another Joy-Con?</h2>
          <p>This clears the in-memory session, disconnects this controller, and starts fresh.</p>
        </div>
        <Button onClick={onStartAgain}>Start again →</Button>
      </div>
    </>
  );
}

function PageFrame({
  eyebrow,
  title,
  lede,
  className = '',
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className={`page-heading ${className}`.trim()}>
        {lede ? (
          <>
            <div>
              <span className="comic-kicker">{eyebrow}</span>
              <h1>{title}</h1>
            </div>
            <p className="page-lede">{lede}</p>
          </>
        ) : (
          <>
            <span className="comic-kicker">{eyebrow}</span>
            <h1>{title}</h1>
          </>
        )}
      </div>
      {children}
    </>
  );
}

function ProtocolLab({
  identity,
  sampleCount,
  latest,
}: {
  identity: ControllerIdentity;
  sampleCount: number;
  latest: ControllerSample | null;
}) {
  return (
    <Panel className="protocol-lab no-print">
      <strong>Protocol lab · developer view</strong>
      <dl>
        <div>
          <dt>Controller</dt>
          <dd>{identity.kind}</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>{identity.connection}</dd>
        </div>
        <div>
          <dt>Samples</dt>
          <dd>{sampleCount}</dd>
        </div>
        <div>
          <dt>Report timer</dt>
          <dd>{latest?.reportTimer ?? 'N/A'}</dd>
        </div>
        <div>
          <dt>IMU frames/report</dt>
          <dd>{latest?.imuFrames.length ?? 'N/A'}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function analyzeCapture(
  id: Exclude<CaptureTestId, 'motion'>,
  samples: ControllerSample[],
  sticks: StickId[],
  pageStayedVisible: boolean
) {
  if (id === 'drift') return sticks.map((stick) => analyzeNeutral(samples, stick));
  if (id === 'range') return sticks.map((stick) => analyzeRange(samples, stick));
  if (id === 'snapback') return sticks.map((stick) => analyzeSnapback(samples, stick));
  if (id === 'stationary') return [analyzeStationaryImu(samples)];
  return [analyzePackets(samples, pageStayedVisible)];
}

function applicableButtons(identity: ControllerIdentity): ControllerButton[] {
  if (identity.kind === 'joycon-left')
    return [
      'up',
      'down',
      'left',
      'right',
      'l',
      'zl',
      'minus',
      'leftStick',
      'capture',
      'slLeft',
      'srLeft',
    ];
  if (identity.kind === 'joycon-right')
    return ['a', 'b', 'x', 'y', 'r', 'zr', 'plus', 'rightStick', 'home', 'slRight', 'srRight'];
  return [];
}

function sticksFor(identity: ControllerIdentity): StickId[] {
  if (identity.kind === 'joycon-left') return ['left'];
  return ['right'];
}

function instructionTitle(id: TestDefinition['id']) {
  if (id === 'drift') return 'Put it down. Don’t touch the sticks.';
  if (id === 'range') return 'Three slow circles around the edge.';
  if (id === 'snapback') return 'Flick, release, repeat in four directions.';
  if (id === 'stationary') return 'Set it flat and keep it completely still.';
  if (id === 'motion') return 'Rotate around X, Y, then Z.';
  return 'Keep it connected and awake.';
}

function testResultIsPresent(id: TestDefinition['id'], resultIds: Set<string>) {
  if (id === 'drift') return [...resultIds].some((result) => result.startsWith('stick-neutral-'));
  if (id === 'range') return [...resultIds].some((result) => result.startsWith('stick-range-'));
  if (id === 'snapback')
    return [...resultIds].some((result) => result.startsWith('stick-snapback-'));
  if (id === 'stationary') return resultIds.has('imu-stationary');
  if (id === 'motion') return resultIds.has('imu-motion');
  if (id === 'packets') return resultIds.has('packet-stability');
  return resultIds.has('led') || resultIds.has('rumble');
}

function resultForTest(id: TestDefinition['id'], results: DiagnosticResult[]) {
  const matches = results.filter((result) => {
    const ids = new Set([result.testId]);
    return testResultIsPresent(id, ids);
  });
  const priority: Record<DiagnosticResult['status'], number> = {
    'potential-issue': 4,
    'check-again': 3,
    inconclusive: 2,
    skipped: 1,
    pass: 0,
  };
  return matches.sort((a, b) => priority[b.status] - priority[a.status])[0];
}

function resultLabel(status: DiagnosticResult['status']) {
  if (status === 'potential-issue') return 'Potential issue';
  if (status === 'check-again') return 'Check again';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function testOutcomeLabel(status: DiagnosticResult['status']) {
  if (status === 'pass') return 'Success';
  if (status === 'potential-issue') return 'Failure';
  return 'Inconclusive';
}

function captureTestForResult(testId: string): CaptureTestId | null {
  if (testId.startsWith('stick-neutral-')) return 'drift';
  if (testId.startsWith('stick-range-')) return 'range';
  if (testId.startsWith('stick-snapback-')) return 'snapback';
  if (testId === 'imu-stationary') return 'stationary';
  if (testId === 'imu-motion') return 'motion';
  if (testId === 'packet-stability') return 'packets';
  return null;
}

function formatBattery(battery: ControllerSample['battery']) {
  return `${battery.percentage}% battery${battery.charging ? ', charging' : ''}`;
}
