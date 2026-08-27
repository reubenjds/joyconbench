import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerIdentity } from '../types/controller';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  initialize: vi.fn(),
  ownsDevice: vi.fn(),
  readColors: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock('../adapters/NintendoControllerAdapter', () => ({
  NintendoControllerAdapter: vi.fn(() => mocks),
}));

import { useController } from './useController';

const identity: ControllerIdentity = {
  kind: 'joycon-left',
  displayName: 'Left Joy-Con',
  vendorId: 0x057e,
  productId: 0x2006,
  connection: 'bluetooth',
};

function dispatchDisconnect(hid: EventTarget, device: HIDDevice) {
  const event = new Event('disconnect');
  Object.defineProperty(event, 'device', { value: device });
  hid.dispatchEvent(event);
}

describe('useController connection lifecycle', () => {
  let hid: EventTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    hid = new EventTarget();
    Object.defineProperty(navigator, 'hid', { configurable: true, value: hid });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    mocks.connect.mockResolvedValue(identity);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.initialize.mockResolvedValue(undefined);
    mocks.ownsDevice.mockReturnValue(false);
    mocks.readColors.mockResolvedValue({ body: '#828282', buttons: '#0f0f0f' });
  });

  it('closes and clears the adapter when initialization fails', async () => {
    mocks.initialize.mockRejectedValue(new Error('Initialization failed.'));
    const { result } = renderHook(() => useController());

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow('Initialization failed.');
    });

    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Initialization failed.');
    expect(result.current.identity).toBeNull();
  });

  it('ignores disconnect events for other HID devices', async () => {
    const unrelatedDevice = {} as HIDDevice;
    const { result } = renderHook(() => useController());
    await act(async () => void (await result.current.connect()));

    act(() => dispatchDisconnect(hid, unrelatedDevice));

    expect(mocks.ownsDevice).toHaveBeenCalledWith(unrelatedDevice);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(result.current.status).toBe('ready');
    expect(result.current.identity).toEqual(identity);
  });

  it('clears state when the connected HID device disconnects', async () => {
    const connectedDevice = {} as HIDDevice;
    mocks.ownsDevice.mockImplementation((device) => device === connectedDevice);
    const { result } = renderHook(() => useController());
    await act(async () => void (await result.current.connect()));

    await act(async () => {
      dispatchDisconnect(hid, connectedDevice);
      await Promise.resolve();
    });

    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('disconnected');
    expect(result.current.error).toMatch(/disconnected/i);
    expect(result.current.identity).toBeNull();
  });

  it('does not restore ready state after a connection is cancelled', async () => {
    let finishInitialization: () => void = () => undefined;
    mocks.initialize.mockImplementation(
      () => new Promise<void>((resolve) => (finishInitialization = resolve))
    );
    const { result } = renderHook(() => useController());
    let connection!: Promise<ControllerIdentity>;

    act(() => {
      connection = result.current.connect();
    });
    const rejection = expect(connection).rejects.toThrow(/cancelled/i);
    await act(async () => void (await result.current.disconnect()));
    await act(async () => finishInitialization());
    await rejection;

    expect(result.current.status).toBe('idle');
    expect(result.current.identity).toBeNull();
  });
});
