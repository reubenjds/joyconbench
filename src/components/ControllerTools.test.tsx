import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_REGIONS, buildSettingsBackup, encodeSettingsBackup } from '../protocol/settings';
import type { ControllerAdapter, ControllerIdentity } from '../types/controller';
import { ControllerTools } from './ControllerTools';

const identity: ControllerIdentity = {
  kind: 'joycon-left',
  displayName: 'Left Joy-Con',
  vendorId: 0x057e,
  productId: 0x2006,
  connection: 'bluetooth',
};

function makeAdapter() {
  return {
    writeColors: vi.fn().mockResolvedValue(undefined),
    restoreSettings: vi.fn().mockResolvedValue(undefined),
  } as unknown as ControllerAdapter;
}

function renderTools(adapter: ControllerAdapter) {
  const props = {
    adapter,
    identity,
    batteryCritical: false,
    initialColors: { body: '#828282', buttons: '#0f0f0f' },
    onColorsChange: vi.fn(),
  };
  const rendered = render(<ControllerTools {...props} />);
  return { ...rendered, props };
}

describe('ControllerTools persistent-write safety', () => {
  it('blocks a colour write if the battery becomes critical while confirmation is open', () => {
    const adapter = makeAdapter();
    const { rerender, props } = renderTools(adapter);
    fireEvent.click(screen.getByRole('button', { name: 'Write colours' }));

    rerender(<ControllerTools {...props} batteryCritical />);

    const confirm = screen.getByRole('button', { name: 'Write and verify' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(adapter.writeColors).not.toHaveBeenCalled();
  });

  it('blocks restore if the battery becomes critical while confirmation is open', async () => {
    const adapter = makeAdapter();
    const { container, rerender, props } = renderTools(adapter);
    const backup = await buildSettingsBackup(
      identity,
      SETTINGS_REGIONS.map((region) => ({
        name: region.name,
        address: region.address,
        dataHex: '00'.repeat(region.length),
      }))
    );
    const bytes = await encodeSettingsBackup(backup);
    const file = {
      name: 'left-settings.bin',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    } as File;
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('dialog', { name: 'Restore this settings backup?' });

    rerender(<ControllerTools {...props} batteryCritical />);

    const confirm = screen.getByRole('button', { name: 'Restore and verify' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(adapter.restoreSettings).not.toHaveBeenCalled());
  });
});
