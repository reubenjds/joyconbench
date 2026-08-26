export const NINTENDO_VENDOR_ID = 0x057e;
export const SUPPORTED_PRODUCT_IDS = [0x2006, 0x2007] as const;

export type ControllerKind = 'joycon-left' | 'joycon-right';
export type ConnectionKind = 'bluetooth' | 'unknown';
export type BatteryPercentage = 0 | 25 | 50 | 75 | 100;
export interface BatteryStatus {
  percentage: BatteryPercentage;
  charging: boolean;
}
export type StickId = 'left' | 'right';

export type Vector2 = { x: number; y: number };
export type Vector3 = { x: number; y: number; z: number };

export interface StickAxisCalibration {
  minimum: number;
  center: number;
  maximum: number;
}

export interface StickCalibration {
  x: StickAxisCalibration;
  y: StickAxisCalibration;
}

export type StickCalibrationSet = Partial<Record<StickId, StickCalibration>>;

export type ControllerButton =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'l'
  | 'zl'
  | 'r'
  | 'zr'
  | 'minus'
  | 'plus'
  | 'leftStick'
  | 'rightStick'
  | 'home'
  | 'capture'
  | 'slLeft'
  | 'srLeft'
  | 'slRight'
  | 'srRight';

export type ButtonState = Record<ControllerButton, boolean>;

export interface ImuFrame {
  offsetMs: number;
  accelerometer: Vector3;
  gyroscope: Vector3;
}

export interface ControllerSample {
  timestamp: number;
  buttons: ButtonState;
  sticks: Partial<Record<StickId, Vector2>>;
  rawSticks: Partial<Record<StickId, Vector2>>;
  imuFrames: readonly [ImuFrame, ImuFrame, ImuFrame];
  battery: BatteryStatus;
  packetCounter: number;
  connection: ConnectionKind;
}

export interface ControllerIdentity {
  kind: ControllerKind;
  displayName: string;
  vendorId: number;
  productId: number;
  connection: ConnectionKind;
}

export interface ControllerColors {
  body: string;
  buttons: string;
}

export interface ControllerSettingsSegment {
  name: string;
  address: number;
  dataHex: string;
}

export interface ControllerSettingsBackup {
  format: 'joyconbench-controller-settings-v1';
  createdAt: string;
  controller: Pick<ControllerIdentity, 'kind' | 'productId'>;
  segments: ControllerSettingsSegment[];
  checksum: { algorithm: 'SHA-256'; hex: string };
}

export type SettingsProgress = (completed: number, total: number, label: string) => void;

export type DiagnosticStatus = 'pass' | 'potential-issue' | 'inconclusive' | 'skipped';

export interface DiagnosticResult {
  testId: string;
  title: string;
  status: DiagnosticStatus;
  measurements: Record<string, number | string | boolean>;
  explanation: string;
  interpretation: string;
  recommendations: string[];
}

export interface DiagnosticReport {
  schemaVersion: 1;
  applicationVersion: string;
  browser: { name: string; platform: string };
  controller: {
    kind: ControllerKind;
    connection: ConnectionKind;
    vendorId?: number;
    productId?: number;
  };
  results: DiagnosticResult[];
  createdAt: string;
  privacy: { rawSamplesIncluded: false; identifyingValuesIncluded: false };
}

export type SampleListener = (sample: ControllerSample) => void;
export type Unsubscribe = () => void;

export interface ControllerAdapter {
  connect(device?: HIDDevice): Promise<ControllerIdentity>;
  disconnect(): Promise<void>;
  initialize(): Promise<void>;
  identify(): Promise<ControllerIdentity>;
  enableInput(): Promise<void>;
  enableImu(): Promise<void>;
  rumble(durationMs?: number): Promise<void>;
  setPlayerLeds(pattern: number): Promise<void>;
  readColors(): Promise<ControllerColors>;
  writeColors(colors: ControllerColors): Promise<void>;
  backupSettings(onProgress?: SettingsProgress): Promise<ControllerSettingsBackup>;
  restoreSettings(backup: ControllerSettingsBackup, onProgress?: SettingsProgress): Promise<void>;
  subscribe(listener: SampleListener): Unsubscribe;
}

export const EMPTY_BUTTONS: ButtonState = {
  a: false,
  b: false,
  x: false,
  y: false,
  up: false,
  down: false,
  left: false,
  right: false,
  l: false,
  zl: false,
  r: false,
  zr: false,
  minus: false,
  plus: false,
  leftStick: false,
  rightStick: false,
  home: false,
  capture: false,
  slLeft: false,
  srLeft: false,
  slRight: false,
  srRight: false,
};

export function controllerKindFromProductId(productId: number): ControllerKind | null {
  if (productId === 0x2006) return 'joycon-left';
  if (productId === 0x2007) return 'joycon-right';
  return null;
}

export function controllerDisplayName(kind: ControllerKind): string {
  if (kind === 'joycon-left') return 'Left Joy-Con';
  return 'Right Joy-Con';
}
