import { useRef, useState, type ChangeEvent } from 'react';
import type { NintendoControllerAdapter } from '../adapters/NintendoControllerAdapter';
import { validateSettingsBackup } from '../protocol/settings';
import type {
  ControllerColors,
  ControllerIdentity,
  ControllerSettingsBackup,
} from '../types/controller';
import { ControllerDiagram } from './ControllerDiagram';
import { Button, Modal, Panel } from './ui';

const DEFAULT_COLORS: ControllerColors = { body: '#0000ff', buttons: '#111111' };

export function ControllerTools({
  adapter,
  identity,
  batteryCritical,
}: {
  adapter: NintendoControllerAdapter;
  identity: ControllerIdentity;
  batteryCritical: boolean;
}) {
  const [colors, setColors] = useState(DEFAULT_COLORS);
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
      downloadJson(backup, `${identity.kind}-settings-${dateStamp()}.json`);
      setMessage('Settings backup downloaded. Keep it with the matching controller.');
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
      const parsed = JSON.parse(await file.text()) as unknown;
      const backup = await validateSettingsBackup(parsed, identity);
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
              accept="application/json,.json"
              onChange={chooseBackup}
            />
          </div>
          <p className="tool-fine-print">
            Restore accepts only intact JoyConBench backups for the same controller product type.
            Every chunk is read back and verified.
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

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
