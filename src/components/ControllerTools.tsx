import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import type { NintendoControllerAdapter } from '../adapters/NintendoControllerAdapter';
import {
  decodeSettingsBackup,
  encodeSettingsBackup,
  isBinarySettingsBackup,
  validateSettingsBackup,
} from '../protocol/settings';
import type {
  ControllerColors,
  ControllerIdentity,
  ControllerSettingsBackup,
} from '../types/controller';
import { ControllerDiagram } from './ControllerDiagram';
import { Button, Modal, Panel } from './ui';

const RETAIL_COLORS: ReadonlyArray<{ name: string; colors: ControllerColors }> = [
  { name: 'Gray', colors: { body: '#828282', buttons: '#0f0f0f' } },
  { name: 'Neon red', colors: { body: '#ff3c28', buttons: '#1e0a0a' } },
  { name: 'Neon blue', colors: { body: '#0ab9e6', buttons: '#001e1e' } },
  { name: 'Neon yellow', colors: { body: '#e6ff00', buttons: '#142800' } },
  { name: 'Neon green', colors: { body: '#1edc00', buttons: '#002800' } },
  { name: 'Neon pink', colors: { body: '#ff3278', buttons: '#28001e' } },
  { name: 'Red', colors: { body: '#e10f00', buttons: '#280a0a' } },
  { name: 'Blue', colors: { body: '#4655f5', buttons: '#00000a' } },
  { name: 'Neon purple', colors: { body: '#b400e6', buttons: '#140014' } },
  { name: 'Neon orange', colors: { body: '#faa005', buttons: '#0f0a00' } },
  { name: 'White', colors: { body: '#e6e6e6', buttons: '#323232' } },
  { name: 'Pastel pink', colors: { body: '#ffafaf', buttons: '#372d2d' } },
  { name: 'Pastel yellow', colors: { body: '#f5ff82', buttons: '#32332d' } },
  { name: 'Pastel purple', colors: { body: '#f0cbeb', buttons: '#373037' } },
  { name: 'Pastel green', colors: { body: '#bcffc8', buttons: '#2d322d' } },
];

export function ControllerTools({
  adapter,
  identity,
  batteryCritical,
}: {
  adapter: NintendoControllerAdapter;
  identity: ControllerIdentity;
  batteryCritical: boolean;
}) {
  const [colors, setColors] = useState(() => defaultColors(identity));
  const [pendingBackup, setPendingBackup] = useState<ControllerSettingsBackup | null>(null);
  const [pendingFile, setPendingFile] = useState('');
  const [confirmColor, setConfirmColor] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Nothing has been written to the controller.');
  const [progress, setProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadColors = async () => {
    await runTool('Reading controller colours…', async () => {
      setColors(await adapter.readColors());
      setMessage('Controller colours loaded.');
    });
  };

  const saveColors = async () => {
    setConfirmColor(false);
    await runTool('Writing and verifying colours…', async () => {
      await adapter.writeColors(colors);
      setMessage(
        'Colours verified. Re-pair or restart the console if it still shows the old shell.'
      );
    });
  };

  const createBackup = async () => {
    await runTool('Reading documented settings…', async () => {
      const backup = await adapter.backupSettings((completed, total, label) => {
        setProgress(Math.round((completed / total) * 100));
        setMessage(label);
      });
      downloadBinary(
        await encodeSettingsBackup(backup),
        `${identity.kind}-settings-${dateStamp()}.bin`
      );
      setMessage('Binary settings backup downloaded. Keep it with the matching controller.');
    });
  };

  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) {
      setMessage('That file is too large to be a JoyConBench settings backup.');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let backup: ControllerSettingsBackup;
      if (isBinarySettingsBackup(bytes)) {
        backup = await decodeSettingsBackup(bytes, identity);
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new Error('Choose a JoyConBench .bin backup or legacy JoyConBench .json backup.');
        }
        backup = await validateSettingsBackup(parsed, identity);
      }
      setPendingBackup(backup);
      setPendingFile(file.name);
      setConfirmRestore(true);
      setMessage('Backup checked. Review the restore warning.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The backup could not be read.');
    }
  };

  const restoreBackup = async () => {
    if (!pendingBackup) return;
    setConfirmRestore(false);
    await runTool('Restoring documented settings…', async () => {
      await adapter.restoreSettings(pendingBackup, (completed, total, label) => {
        setProgress(Math.round((completed / total) * 100));
        setMessage(label);
      });
      setPendingBackup(null);
      setPendingFile('');
      setMessage('Restore verified. Disconnect and reconnect the controller before testing it.');
    });
  };

  const runTool = async (initialMessage: string, action: () => Promise<void>) => {
    setBusy(true);
    setProgress(0);
    setMessage(initialMessage);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The controller tool failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {batteryCritical && (
        <div className="tool-warning" role="alert">
          Persistent tools are paused because the controller reports a critical battery level.
        </div>
      )}
      <div className="tools-grid">
        <Panel className="color-tool color-blue">
          <span className="sticker">Appearance</span>
          <div className="tool-preview">
            <ControllerDiagram kind={identity.kind} colors={colors} />
          </div>
          <div className="color-fields">
            <label>
              <span>Body</span>
              <input
                type="color"
                value={colors.body}
                onChange={(event) => setColors({ ...colors, body: event.target.value })}
              />
              <code>{colors.body.toUpperCase()}</code>
            </label>
            <label>
              <span>Buttons</span>
              <input
                type="color"
                value={colors.buttons}
                onChange={(event) => setColors({ ...colors, buttons: event.target.value })}
              />
              <code>{colors.buttons.toUpperCase()}</code>
            </label>
          </div>
          <div className="retail-colors">
            <div className="retail-colors-heading">
              <strong>Retail colours</strong>
              <span>Choose a preset, then write</span>
            </div>
            <div className="retail-color-grid">
              {RETAIL_COLORS.map((preset) => {
                const selected =
                  colors.body.toLowerCase() === preset.colors.body &&
                  colors.buttons.toLowerCase() === preset.colors.buttons;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    className={selected ? 'retail-color selected' : 'retail-color'}
                    aria-pressed={selected}
                    onClick={() => setColors(preset.colors)}
                  >
                    <span
                      className="retail-color-swatch"
                      style={
                        {
                          '--retail-body': preset.colors.body,
                          '--retail-buttons': preset.colors.buttons,
                        } as CSSProperties
                      }
                      aria-hidden="true"
                    />
                    <span>{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="tool-actions">
            <Button className="button-secondary" onClick={loadColors} disabled={busy}>
              Read current colours
            </Button>
            <Button onClick={() => setConfirmColor(true)} disabled={busy || batteryCritical}>
              Write colours
            </Button>
          </div>
        </Panel>

        <Panel className="backup-tool color-red">
          <span className="sticker">Settings backup</span>
          <h2>Back up before making changes</h2>
          <p>
            Saves 97 bytes from documented colour, calibration, and sensor-parameter regions. It
            excludes serial, pairing, firmware, patch, and unidentified flash data.
          </p>
          <div className="backup-stack">
            <Button onClick={createBackup} disabled={busy}>
              Download settings backup
            </Button>
            <Button
              className="button-secondary"
              onClick={() => fileInput.current?.click()}
              disabled={busy || batteryCritical}
            >
              Choose backup to restore
            </Button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="application/octet-stream,application/json,.bin,.json"
              onChange={chooseBackup}
            />
          </div>
          <p className="tool-fine-print">
            JoyConBench .bin files are compact settings backups, not the old toolkit’s 512 KB raw
            SPI images. Legacy JoyConBench JSON backups are still accepted. Every chunk is checked
            before writing and verified afterward.
          </p>
        </Panel>
      </div>

      <div className="tool-status" role="status" aria-live="polite">
        <span>{busy ? `${progress}%` : 'READY'}</span>
        <p>{message}</p>
      </div>

      <Modal
        open={confirmColor}
        title="Write controller colours?"
        onClose={() => setConfirmColor(false)}
      >
        <div className="warning-copy">
          <p>This makes a persistent change to the controller’s documented colour settings.</p>
          <p>
            Create a backup first. Keep the controller charged and connected until verification
            finishes.
          </p>
        </div>
        <div className="modal-actions">
          <Button className="button-secondary" onClick={() => setConfirmColor(false)}>
            Cancel
          </Button>
          <Button onClick={saveColors}>Write and verify</Button>
        </div>
      </Modal>

      <Modal
        open={confirmRestore}
        title="Restore this settings backup?"
        onClose={() => setConfirmRestore(false)}
      >
        <div className="warning-copy">
          <p>
            <strong>{pendingFile}</strong> passed its checksum and controller-type checks.
          </p>
          <p>
            This overwrites documented colour, factory calibration, and sensor-parameter regions. Do
            not disconnect while it runs.
          </p>
        </div>
        <div className="modal-actions">
          <Button className="button-secondary" onClick={() => setConfirmRestore(false)}>
            Cancel
          </Button>
          <Button onClick={restoreBackup}>Restore and verify</Button>
        </div>
      </Modal>
    </>
  );
}

function downloadBinary(value: Uint8Array, filename: string) {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function defaultColors(identity: ControllerIdentity): ControllerColors {
  if (identity.kind === 'joycon-left') return RETAIL_COLORS[2].colors;
  if (identity.kind === 'joycon-right') return RETAIL_COLORS[1].colors;
  return RETAIL_COLORS[0].colors;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
