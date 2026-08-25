import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  createConfirmationResult,
} from './diagnostics/calculations';
import { useController } from './hooks/useController';
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
    description: 'Measure neutral offset and jitter—the quickest check for unwanted movement.',
    duration: 5000,
    action: 'Run 5-second drift check',
    featured: true,
  },
  {
    id: 'range',
    number: '02',
    title: 'Circular range',
    short: 'Full travel',
    description: 'Trace three rotations to spot restricted or uneven stick travel.',
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
    description: 'Rotate around X, Y, and Z and confirm each gyroscope axis responds.',
    duration: 10000,
    action: 'Capture gyro axes',
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
  const controller = useController();
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

  const addResults = (nextResults: DiagnosticResult[]) => {
    setResults((previous) => {
      const ids = new Set(nextResults.map((result) => result.testId));
      return [...previous.filter((result) => !ids.has(result.testId)), ...nextResults];
    });
  };

  const connect = async () => {
    try {
      await controller.connect();
      setPairingOpen(false);
      setView('bench');
    } catch {
      // The hook exposes a safe user-facing error.
    }
  };

  const chooseTest = (test: TestDefinition) => {
    if (test.id === 'outputs') {
      setView('outputs');
      return;
    }
    setSelectedTest(test.id);
    setRunComplete(false);
    setView('test');
  };

  const runSelectedTest = async () => {
    if (!selectedTest) return;
    const definition = TESTS.find((test) => test.id === selectedTest)!;
    setRunning(true);
    setRunComplete(false);
    const samples = await controller.capture(definition.duration);
    addResults(analyzeCapture(selectedTest, samples, activeSticks));
    setRunning(false);
    setRunComplete(true);
  };

  const saveButtonCheck = () => {
    const missed = requiredButtons.filter((button) => !seenButtons.has(button));
    addResults([
      {
        testId: 'buttons',
        title: 'Button response',
        status: missed.length ? 'potential-issue' : 'pass',
        measurements: {
          expectedButtons: requiredButtons.length,
          observedButtons: requiredButtons.length - missed.length,
          unobserved: missed.map((button) => BUTTON_LABELS[button]).join(', ') || 'None',
        },
        explanation: 'Each applicable button was checked for an input response.',
        interpretation: missed.length
          ? 'One or more buttons were not observed during this checklist.'
          : 'Every applicable button produced an input event.',
        recommendations: missed.length
          ? ['Press each unobserved button again.', 'Reconnect and retest before repair.']
          : ['No action is suggested by this check.'],
      },
    ]);
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
          onClick={() => setView(identity ? 'bench' : 'connect')}
        >
          <span className="brand-icon" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>
            JoyCon<span>Bench</span>
          </span>
        </button>
        {identity ? (
          <nav className="main-nav" aria-label="Workbench">
            <button className={view === 'bench' ? 'active' : ''} onClick={() => setView('bench')}>
              Tests
            </button>
            <button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}>
              Controller tools
            </button>
            <button
              className={view === 'results' || view === 'report' ? 'active' : ''}
              onClick={() => setView('results')}
            >
              Results <span>{results.length}</span>
            </button>
          </nav>
        ) : (
          <p>Private controller diagnostics. No install. No uploads.</p>
        )}
        <div className="header-actions">
          <span className="local-note">● Local only</span>
          <Button className="button-text" onClick={() => setPrivacyOpen(true)}>
            Privacy
          </Button>
        </div>
      </header>

      <main className="workspace">
        {view === 'connect' && (
          <ConnectView
            supported={controller.supported}
            status={controller.status}
            error={controller.error}
            onOpenPairing={() => setPairingOpen(true)}
          />
        )}

        {identity && view !== 'connect' && (
          <div className="device-strip">
            <span className="device-dot" aria-hidden="true" />
            <strong>{identity.displayName}</strong>
            <span>
              {controller.latestSample
                ? formatBattery(controller.latestSample.battery)
                : 'Reading battery'}{' '}
              · {identity.connection}
            </span>
            <Button className="button-text" onClick={startAgain}>
              Test another controller
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
            running={running}
            complete={runComplete}
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
            eyebrow="Persistent tools"
            title="Controller settings"
            lede="Fast, narrowly scoped tools for documented controller settings—not a full flash editor."
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
            <ResultsView results={results} />
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
          <ol className="pairing-steps">
            <li>
              Pair it in your computer’s Bluetooth settings first. Pro Controllers can also use USB.
            </li>
            <li>Keep it awake by pressing a button.</li>
            <li>Choose only the Nintendo controller in the browser picker.</li>
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
            Persistent tools touch only documented colour, calibration, and parameter regions after
            explicit confirmation. Firmware, pairing, erase, patch, and unknown regions remain
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
}: {
  supported: boolean;
  status: string;
  error: string | null;
  onOpenPairing: () => void;
}) {
  return (
    <div className="connect-hero">
      <section className="hero-blue">
        <h1 aria-label="See exactly what your controller is doing.">
          See exactly what your
          <br />
          controller is doing.
        </h1>
        <p>
          Connect a Joy-Con or Pro Controller to view every input live. Check for drift, test
          individual features, and save a private diagnostic report.
        </p>
        {supported ? (
          <Button onClick={onOpenPairing} disabled={status === 'connecting'}>
            Connect controller
          </Button>
        ) : (
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
        <div className="speech-bubble">
          <strong>Runs in your browser</strong>
          <span>Nothing uploaded</span>
        </div>
        <ol className="hero-benefits">
          <li>The live button test opens immediately</li>
          <li>Run only the diagnostics you need</li>
          <li>Switch controllers without reloading</li>
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
  const resultIds = new Set(results.map((result) => result.testId));
  const buttonResult = results.find((result) => result.testId === 'buttons');
  return (
    <>
      <div className="bench-title">
        <div>
          <span className="comic-kicker">Live input</span>
          <h1>Button test</h1>
        </div>
        <p>
          The controller drawing reacts live. This button check is always ready—no timer and no
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
            {buttonResult && <StatusLabel status={buttonResult.status}>Saved</StatusLabel>}
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
            <Button onClick={onSaveButtons}>Save button result</Button>
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
            const done = testResultIsPresent(test.id, resultIds);
            return (
              <article key={test.id} className={`test-card ${test.featured ? 'featured' : ''}`}>
                <div className="test-number">{test.number}</div>
                <div className="test-copy">
                  <span>{test.short}</span>
                  <h3>{test.title}</h3>
                  <p>{test.description}</p>
                </div>
                {done && <StatusLabel status="pass">Done</StatusLabel>}
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
  running,
  complete,
  onRun,
  onBack,
}: {
  test: TestDefinition;
  sticks: StickId[];
  samples: ControllerSample[];
  running: boolean;
  complete: boolean;
  onRun: () => void;
  onBack: () => void;
}) {
  const isImuTest = test.id === 'stationary' || test.id === 'motion';
  return (
    <PageFrame eyebrow={`Test ${test.number} · ${test.short}`} title={test.title}>
      <div className="capture-instruction">
        <CaptureCountdown durationMs={test.duration} running={running} complete={complete} />
        <div>
          <h2>{instructionTitle(test.id)}</h2>
          <p>{test.description}</p>
        </div>
        <Button onClick={onRun} disabled={running}>
          {running ? 'Capturing…' : complete ? 'Run it again' : test.action}
        </Button>
      </div>
      {complete && (
        <div className="capture-complete" role="status">
          Result saved. Run it again or choose another test.
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
  const resultIds = new Set(results.map((result) => result.testId));
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
  return (
    <PageFrame eyebrow="Optional output checks" title="Lights and rumble">
      <div className="output-grid">
        {(['led', 'rumble'] as const).map((test) => {
          const done = resultIds.has(test);
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
                  <Button onClick={() => onResult(createConfirmationResult(test, title, 'yes'))}>
                    Yep!
                  </Button>
                  <Button
                    className="button-secondary"
                    onClick={() => onResult(createConfirmationResult(test, title, 'no'))}
                  >
                    Nope
                  </Button>
                </div>
              )}
              {done && (
                <StatusLabel status={results.find((result) => result.testId === test)!.status}>
                  Recorded
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

function ResultsView({ results }: { results: DiagnosticResult[] }) {
  const issueCount = results.filter((result) => result.status === 'potential-issue').length;
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
            Research-based reference ranges produce practical conclusions. Inconclusive means the
            test did not capture enough usable input.
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
          <h2>Share the measurements—not the controller.</h2>
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
          <dt>Packet counter</dt>
          <dd>{latest?.packetCounter ?? '—'}</dd>
        </div>
        <div>
          <dt>IMU frames/report</dt>
          <dd>{latest?.imuFrames.length ?? '—'}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function analyzeCapture(id: CaptureTestId, samples: ControllerSample[], sticks: StickId[]) {
  if (id === 'drift') return sticks.map((stick) => analyzeNeutral(samples, stick));
  if (id === 'range') return sticks.map((stick) => analyzeRange(samples, stick));
  if (id === 'snapback') return sticks.map((stick) => analyzeSnapback(samples, stick));
  if (id === 'stationary') return [analyzeStationaryImu(samples)];
  if (id === 'motion') return [analyzeMotion(samples)];
  return [analyzePackets(samples)];
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
  return [
    'a',
    'b',
    'x',
    'y',
    'up',
    'down',
    'left',
    'right',
    'l',
    'zl',
    'r',
    'zr',
    'minus',
    'plus',
    'leftStick',
    'rightStick',
    'home',
    'capture',
  ];
}

function sticksFor(identity: ControllerIdentity): StickId[] {
  if (identity.kind === 'joycon-left') return ['left'];
  if (identity.kind === 'joycon-right') return ['right'];
  return ['left', 'right'];
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

function resultLabel(status: DiagnosticResult['status']) {
  if (status === 'potential-issue') return 'Potential issue';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatBattery(battery: ControllerSample['battery']) {
  return `${battery.percentage}% battery${battery.charging ? ', charging' : ''}`;
}
