import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SETTINGS_REGIONS,
  buildSettingsBackup,
  validateSettingsBackup,
} from '../protocol/settings';
import {
  EMPTY_BUTTONS,
  type ControllerAdapter,
  type ControllerButton,
  type ControllerColors,
  type ControllerIdentity,
  type ControllerSample,
  type ControllerSettingsBackup,
  type SampleListener,
  type SettingsProgress,
} from '../types/controller';

const DEMO_IDENTITY: ControllerIdentity = {
  kind: 'joycon-left',
  displayName: 'Preview Left Joy-Con',
  vendorId: 0x057e,
  productId: 0x2006,
  connection: 'bluetooth',
};

const DEMO_BUTTONS: ControllerButton[] = [
  'up',
  'right',
  'down',
  'left',
  'l',
  'zl',
  'minus',
  'capture',
  'leftStick',
  'slLeft',
  'srLeft',
];

class DemoControllerAdapter implements ControllerAdapter {
  private readonly listeners = new Set<SampleListener>();
  private timer = 0;
  private colors: ControllerColors = {
    body: '#0ab9e6',
    buttons: '#001e1e',
  };
  private connected = false;

  async connect() {
    this.connected = true;
    return DEMO_IDENTITY;
  }

  async disconnect() {
    this.connected = false;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  async initialize() {
    if (!this.connected) throw new Error('Preview session is not active.');
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      const timestamp = performance.now();
      const sample = makeDemoSample(timestamp, Math.floor(timestamp / 33));
      for (const listener of this.listeners) listener(sample);
    }, 33);
  }

  async identify() {
    if (!this.connected) throw new Error('Preview session is not active.');
    return DEMO_IDENTITY;
  }

  async enableInput() {}
  async enableImu() {}

  async rumble(durationMs = 300) {
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(durationMs, 300)));
  }

  async setPlayerLeds() {}

  async readColors() {
    return this.colors;
  }

  async writeColors(colors: ControllerColors) {
    this.colors = colors;
  }

  async backupSettings(onProgress?: SettingsProgress) {
    const segments = SETTINGS_REGIONS.map((region, index) => {
      onProgress?.(index + 1, SETTINGS_REGIONS.length, `Preparing ${region.name}`);
      return {
        name: region.name,
        address: region.address,
        dataHex: '00'.repeat(region.length),
      };
    });
    return buildSettingsBackup(DEMO_IDENTITY, segments);
  }

  async restoreSettings(backup: ControllerSettingsBackup, onProgress?: SettingsProgress) {
    const validated = await validateSettingsBackup(backup, DEMO_IDENTITY);
    validated.segments.forEach((segment, index) => {
      onProgress?.(index + 1, validated.segments.length, `Previewing ${segment.name}`);
    });
  }

  subscribe(listener: SampleListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useDemoController() {
  const adapterRef = useRef<ControllerAdapter>(new DemoControllerAdapter());
  const samplesRef = useRef<ControllerSample[]>([]);
  const [latestSample, setLatestSample] = useState<ControllerSample | null>(null);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [colors, setColors] = useState<ControllerColors | null>(null);

  useEffect(() => {
    const adapter = adapterRef.current;
    const unsubscribe = adapter.subscribe((sample) => {
      samplesRef.current.push(sample);
      if (samplesRef.current.length > 6000) samplesRef.current.splice(0, 1000);
      setLatestSample(sample);
    });
    return () => {
      unsubscribe();
      void adapter.disconnect();
    };
  }, []);

  const connect = useCallback(async () => {
    const connectedIdentity = await adapterRef.current.connect();
    await adapterRef.current.initialize();
    setIdentity(connectedIdentity);
    setColors(await adapterRef.current.readColors());
    return connectedIdentity;
  }, []);

  const disconnect = useCallback(async () => {
    await adapterRef.current.disconnect();
    samplesRef.current = [];
    setLatestSample(null);
    setIdentity(null);
    setColors(null);
  }, []);

  const capture = useCallback(async (durationMs: number) => {
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    const count = Math.max(1, Math.floor(durationMs / 16));
    const end = performance.now();
    return Array.from({ length: count }, (_, index) =>
      makeDemoSample(end - durationMs + index * 16, index)
    );
  }, []);

  return {
    adapter: adapterRef.current,
    capture,
    colors,
    connect,
    disconnect,
    error: null,
    identity,
    latestSample,
    samplesRef,
    setColors,
    status: identity ? ('ready' as const) : ('idle' as const),
    supported: true,
  };
}

function makeDemoSample(timestamp: number, index: number): ControllerSample {
  const phase = timestamp / 900;
  const left = { x: Math.sin(phase) * 0.55, y: Math.cos(phase * 0.82) * 0.55 };
  const buttons = { ...EMPTY_BUTTONS };
  buttons[DEMO_BUTTONS[Math.floor(timestamp / 700) % DEMO_BUTTONS.length]] = true;
  const makeImuFrame = (frame: number) => ({
    offsetMs: frame * 5,
    accelerometer: {
      x: Math.sin(phase + frame * 0.08) * 0.12,
      y: Math.cos(phase + frame * 0.08) * 0.12,
      z: 1,
    },
    gyroscope: {
      x: Math.sin(phase + frame * 0.08) * 35,
      y: Math.cos(phase * 0.8 + frame * 0.08) * 28,
      z: Math.sin(phase * 0.6) * 18,
    },
  });
  const imuFrames: ControllerSample['imuFrames'] = [
    makeImuFrame(0),
    makeImuFrame(1),
    makeImuFrame(2),
  ];

  return {
    timestamp,
    buttons,
    sticks: { left },
    rawSticks: {
      left: { x: 2048 + left.x * 1500, y: 2048 + left.y * 1500 },
    },
    imuFrames,
    battery: { percentage: 100, charging: false },
    packetCounter: index % 16,
    connection: 'bluetooth',
  };
}
