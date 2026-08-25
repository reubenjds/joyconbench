interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDDeviceRequestOptions {
  filters: HIDDeviceFilter[];
  exclusionFilters?: HIDDeviceFilter[];
}

interface HIDReportItem {
  reportId: number;
}

interface HIDCollectionInfo {
  usagePage: number;
  usage: number;
  inputReports?: HIDReportItem[];
  outputReports?: HIDReportItem[];
  featureReports?: HIDReportItem[];
  children?: HIDCollectionInfo[];
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  forget?(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
  addEventListener(
    type: 'inputreport',
    listener: (this: HIDDevice, ev: HIDInputReportEvent) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: 'inputreport',
    listener: (this: HIDDevice, ev: HIDInputReportEvent) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>;
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (this: HID, ev: HIDConnectionEvent) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (this: HID, ev: HIDConnectionEvent) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
}

interface Navigator {
  readonly hid?: HID;
  readonly userAgentData?: {
    readonly brands: Array<{ brand: string; version: string }>;
    readonly mobile: boolean;
    readonly platform: string;
  };
}
