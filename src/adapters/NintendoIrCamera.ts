import { WebHIDTransport } from '../hid/WebHIDTransport';
import {
  INPUT_REPORT_NFC_IR,
  INPUT_REPORT_STANDARD_FULL,
  INPUT_REPORT_SUBCOMMAND_REPLY,
  MCU_COMMAND_GET_STATE,
  MCU_COMMAND_SET_REPORT_MODE,
  SUBCOMMAND_SET_INPUT_MODE,
  SUBCOMMAND_SET_MCU_CONFIG,
  SUBCOMMAND_SET_MCU_STATE,
} from '../protocol/nintendo';
import {
  DEFAULT_IR_SETTINGS,
  IR_MCU_PAYLOAD_BYTES,
  IR_MODE_IMAGE_TRANSFER,
  IR_RESOLUTION_MODES,
  MCU_ACK_CONFIG_WRITE,
  MCU_ACK_IR_MODE_SET,
  MCU_ACK_REGISTERS_SET,
  MCU_MODE_IR,
  MCU_MODE_OFFSET,
  MCU_MODE_STANDBY,
  MCU_REPORT_BUSY,
  MCU_REPORT_EMPTY,
  MCU_REPORT_IR_DATA,
  MCU_REPORT_OFFSET,
  MCU_REPORT_STATE,
  IrFrameAssembler,
  buildAcknowledgementPoll,
  buildExposureRegisterConfig,
  buildIrFragmentPoll,
  buildIrHandshakePoll,
  buildIrModeConfig,
  buildIrRegisterConfig,
  buildMcuModeConfig,
  normalizeIrSettings,
  parseIrFragment,
  type IrAcknowledgement,
  type IrFragmentTelemetry,
} from '../protocol/ir';
import type {
  ControllerKind,
  IrCameraCapability,
  IrCameraSettings,
  IrFrameListener,
  IrStreamStats,
} from '../types/controller';

const SUBCOMMAND_REPLY_OFFSET = 14;
const SUBCOMMAND_ACK_OFFSET = 12;
const SUBCOMMAND_ECHO_OFFSET = 13;
const MAX_DIAGNOSTIC_LINES = 400;

export interface IrCameraTimings {
  configAttempts: number;
  configTimeoutMs: number;
  stateAttempts: number;
  stateTimeoutMs: number;
  subcommandAttempts: number;
}

const DEFAULT_TIMINGS: IrCameraTimings = {
  configAttempts: 8,
  configTimeoutMs: 700,
  stateAttempts: 12,
  stateTimeoutMs: 350,
  subcommandAttempts: 4,
};

interface InputWaiter {
  predicate: (event: HIDInputReportEvent) => boolean;
  resolve: (event: HIDInputReportEvent) => void;
  reject: (error: Error) => void;
  timeout: number;
}

interface McuConfigStage {
  stage: string;
  accept: (reply: Uint8Array) => boolean;
  /** Accepted only after the first few attempts, so the strict reply is preferred. */
  fallback?: (reply: Uint8Array) => boolean;
  /** Sent straight after the configuration write, before waiting for a reply. */
  after?: () => Promise<void>;
}

export class NintendoIrCamera implements IrCameraCapability {
  private readonly listeners = new Set<IrFrameListener>();
  private readonly waiters = new Set<InputWaiter>();
  private assembler = createAssembler(DEFAULT_IR_SETTINGS);
  private readonly log: string[] = [];
  private unsubscribeTransport: (() => void) | null = null;
  private running = false;
  private streaming = false;
  private sequence = 0;
  private startedAt = 0;
  private pollQueue: Promise<void> = Promise.resolve();
  private frameTimes: number[] = [];
  private stats = emptyStats();
  private currentSettings = { ...DEFAULT_IR_SETTINGS };
  private lastAutoExposureAt = 0;

  private readonly timings: IrCameraTimings;

  constructor(
    private readonly transport: WebHIDTransport,
    private readonly controllerKind: () => ControllerKind | null,
    timings: Partial<IrCameraTimings> = {}
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  async start(settings: IrCameraSettings = this.currentSettings) {
    if (this.controllerKind() !== 'joycon-right') {
      throw new Error('The IR camera is available only on an original right Joy-Con.');
    }
    if (this.running) return;

    this.currentSettings = normalizeIrSettings(settings);
    const mode = IR_RESOLUTION_MODES[this.currentSettings.resolution];
    this.assembler = createAssembler(this.currentSettings);

    this.running = true;
    this.streaming = false;
    this.sequence = 0;
    this.stats = emptyStats(this.currentSettings.exposureMicroseconds);
    this.frameTimes = [];
    this.assembler.reset();
    this.log.length = 0;
    this.startedAt = performance.now();
    this.lastAutoExposureAt = 0;
    this.unsubscribeTransport = this.transport.subscribe(this.handleInputReport);

    try {
      // 1. Push the NFC/IR input report, which carries the MCU payload the camera streams through.
      await this.subcommandWithRetry(
        SUBCOMMAND_SET_INPUT_MODE,
        [INPUT_REPORT_NFC_IR],
        'input mode'
      );
      // 2. Power the NFC/IR microcontroller.
      await this.subcommandWithRetry(SUBCOMMAND_SET_MCU_STATE, [0x01], 'MCU resume');
      // 3. Give the MCU time to finish booting. Firmware that never reports standby still works,
      //    so this poll only paces the handshake instead of gating it.
      await this.pollForMcuMode(MCU_MODE_STANDBY, 'MCU standby');
      // 4. Switch the MCU into IR mode. The reply reports the mode it is leaving, not the new one.
      await this.configureMcu(buildMcuModeConfig(), {
        stage: 'MCU IR mode',
        accept: (reply) => reply[0] === MCU_REPORT_STATE,
      });
      await this.pollForMcuMode(MCU_MODE_IR, 'MCU in IR mode');
      // 5. Select image transfer and the fragment count for the requested frame size.
      await this.configureMcu(buildIrModeConfig(mode.fragmentCount), {
        stage: 'IR image transfer',
        accept: (reply) => reply[0] === MCU_ACK_IR_MODE_SET,
      });
      // 6. Sensor registers. The first group is confirmed by an IR status report, which has to be
      //    requested explicitly; the second group ends with the "finalize config" register.
      await this.configureMcu(buildIrRegisterConfig(1, this.currentSettings), {
        stage: 'IR registers 1',
        after: () =>
          this.transport.sendMcuCommand(MCU_COMMAND_SET_REPORT_MODE, buildIrHandshakePoll()),
        accept: isImageTransferStatus,
        fallback: (reply) => reply[0] === MCU_ACK_CONFIG_WRITE,
      });
      await this.configureMcu(buildIrRegisterConfig(2, this.currentSettings), {
        stage: 'IR registers 2',
        accept: (reply) => isImageTransferStatus(reply) || reply[0] === MCU_ACK_CONFIG_WRITE,
      });
      // 7. The first acknowledgement starts the fragment stream.
      this.streaming = true;
      await this.transport.sendMcuCommand(
        MCU_COMMAND_SET_REPORT_MODE,
        buildIrFragmentPoll(0, false, mode.fragmentCount)
      );
      this.record(`streaming started at ${mode.width}x${mode.height}`);
    } catch (error) {
      this.record(`startup failed: ${describe(error)}`);
      await this.restoreStandardMode();
      throw new Error(
        error instanceof Error
          ? `The IR camera could not start: ${error.message}`
          : 'The IR camera could not start.'
      );
    }
  }

  async stop() {
    if (!this.running && !this.unsubscribeTransport) return;
    await this.restoreStandardMode();
  }

  async configure(settings: IrCameraSettings) {
    const next = normalizeIrSettings(settings);
    if (!this.running) {
      this.currentSettings = next;
      return;
    }
    if (next.resolution !== this.currentSettings.resolution) {
      await this.stop();
      await this.start(next);
      return;
    }

    this.streaming = false;
    await this.pollQueue.catch(() => undefined);
    this.currentSettings = next;
    this.stats.exposureMicroseconds = next.exposureMicroseconds;
    this.assembler.reset();
    try {
      await this.configureMcu(buildIrRegisterConfig(1, next), {
        stage: 'live IR settings 1',
        after: () =>
          this.transport.sendMcuCommand(MCU_COMMAND_SET_REPORT_MODE, buildIrHandshakePoll()),
        accept: isImageTransferStatus,
        fallback: (reply) => reply[0] === MCU_ACK_CONFIG_WRITE,
      });
      await this.configureMcu(buildIrRegisterConfig(2, next), {
        stage: 'live IR settings 2',
        accept: (reply) => isImageTransferStatus(reply) || reply[0] === MCU_ACK_CONFIG_WRITE,
      });
      this.streaming = true;
      await this.transport.sendMcuCommand(
        MCU_COMMAND_SET_REPORT_MODE,
        buildIrFragmentPoll(0, false, this.assembler.fragmentCount)
      );
      this.record('live settings applied');
    } catch (error) {
      this.record(`live settings failed: ${describe(error)}`);
      await this.restoreStandardMode();
      throw new Error(`The IR settings could not be applied: ${describe(error)}`);
    }
  }

  settings() {
    return { ...this.currentSettings };
  }

  subscribe(listener: IrFrameListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ordered handshake and streaming trace, for reporting a controller that refuses to start. */
  diagnostics() {
    return [...this.log];
  }

  private async subcommandWithRetry(subcommand: number, payload: number[], stage: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.timings.subcommandAttempts; attempt += 1) {
      try {
        await this.transport.transactSubcommand(subcommand, payload);
        this.record(`${stage}: acknowledged on attempt ${attempt + 1}`);
        return;
      } catch (error) {
        lastError = error;
        this.record(`${stage}: attempt ${attempt + 1} failed (${describe(error)})`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${stage} failed.`);
  }

  /**
   * Writes an MCU configuration payload until the microcontroller answers with the expected
   * acknowledgement. Replies that belong to an earlier stage are ignored rather than treated as a
   * failure, because the MCU answers configuration writes and status requests out of order.
   */
  private async configureMcu(payload: Uint8Array, options: McuConfigStage) {
    let lastReply: Uint8Array | null = null;
    for (let attempt = 0; attempt < this.timings.configAttempts; attempt += 1) {
      const allowFallback = attempt >= 2 && Boolean(options.fallback);
      const waiter = this.createInputWaiter((event) => {
        const reply = readSubcommandReply(event, SUBCOMMAND_SET_MCU_CONFIG);
        if (!reply) return false;
        lastReply = reply;
        return options.accept(reply) || (allowFallback && options.fallback!(reply));
      }, this.timings.configTimeoutMs);

      try {
        await this.transport.sendSubcommand(SUBCOMMAND_SET_MCU_CONFIG, [...payload]);
        await options.after?.();
        await waiter.promise;
        this.record(`${options.stage}: accepted ${format(lastReply)} on attempt ${attempt + 1}`);
        return;
      } catch {
        waiter.cancel();
        this.record(
          `${options.stage}: attempt ${attempt + 1} unanswered (last reply ${format(lastReply)})`
        );
      }
    }
    throw new Error(
      `${options.stage} was not confirmed by the Joy-Con (last reply ${format(lastReply)}).`
    );
  }

  /**
   * Asks the MCU for its mode. Reference implementations treat this as advisory: some firmware
   * never reports an intermediate state, so a missing answer must not stop the handshake.
   */
  private async pollForMcuMode(mode: number, stage: string) {
    for (let attempt = 0; attempt < this.timings.stateAttempts; attempt += 1) {
      const waiter = this.createInputWaiter(
        (event) =>
          event.reportId === INPUT_REPORT_NFC_IR &&
          event.data.byteLength > MCU_MODE_OFFSET &&
          event.data.getUint8(MCU_REPORT_OFFSET) === MCU_REPORT_STATE &&
          event.data.getUint8(MCU_MODE_OFFSET) === mode,
        this.timings.stateTimeoutMs
      );
      try {
        await this.transport.sendMcuCommand(
          MCU_COMMAND_GET_STATE,
          new Uint8Array(IR_MCU_PAYLOAD_BYTES)
        );
        await waiter.promise;
        this.record(`${stage}: reported on attempt ${attempt + 1}`);
        return true;
      } catch {
        waiter.cancel();
      }
    }
    this.record(`${stage}: never reported, continuing anyway`);
    return false;
  }

  private readonly handleInputReport = (event: HIDInputReportEvent) => {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(event)) continue;
      this.finishWaiter(waiter);
      waiter.resolve(event);
    }
    if (!this.streaming || event.reportId !== INPUT_REPORT_NFC_IR) return;
    if (event.data.byteLength <= MCU_REPORT_OFFSET) return;

    const reportType = event.data.getUint8(MCU_REPORT_OFFSET);
    if (reportType !== MCU_REPORT_IR_DATA) {
      // An unanswered empty report drops the MCU into a slow polling mode, so keep it acknowledged.
      if (reportType === MCU_REPORT_EMPTY) this.queueAcknowledgement(this.assembler.repeat());
      else if (reportType === MCU_REPORT_BUSY) this.queueAcknowledgement(this.assembler.resend());
      return;
    }

    this.stats.receivedPackets += 1;
    const fragment = parseIrFragment(event.data, this.assembler.fragmentCount);
    if (!fragment) {
      this.stats.malformedPackets += 1;
      this.queueAcknowledgement(this.assembler.resend());
      return;
    }
    const result = this.assembler.accept(fragment);
    this.stats.droppedFragments += result.droppedFragments;
    this.queueAcknowledgement(result.acknowledgement);
    if (result.frame && result.telemetry) this.publishFrame(result.frame, result.telemetry);
  };

  private publishFrame(pixels: Uint8Array, telemetry: IrFragmentTelemetry) {
    const timestamp = performance.now();
    this.frameTimes.push(timestamp);
    this.frameTimes = this.frameTimes.filter((value) => timestamp - value <= 5000);
    this.stats.completedFrames += 1;
    this.stats.lastFrameAt = timestamp;
    this.stats.averageIntensity = telemetry.averageIntensity;
    this.stats.whitePixels = telemetry.whitePixels;
    const sampledPixels = Math.min(this.assembler.fragmentCount, 218) * 300;
    this.stats.whitePixelsPercent = (telemetry.whitePixels * 100) / sampledPixels;
    this.stats.ambientNoisePixels = telemetry.ambientNoisePixels;
    this.stats.ambientNoiseRatio =
      telemetry.ambientNoisePixels / Math.max(1, telemetry.whitePixels);
    this.stats.externalFilterIntensity = telemetry.externalFilterIntensity;
    if (this.frameTimes.length > 1) {
      const seconds = (timestamp - this.frameTimes[0]) / 1000;
      this.stats.framesPerSecond = seconds > 0 ? (this.frameTimes.length - 1) / seconds : 0;
    }
    if (this.stats.completedFrames === 1) this.record('first complete frame received');
    const frame = {
      timestamp,
      sequence: this.sequence++,
      width: this.assembler.width,
      height: this.assembler.height,
      pixels,
    } as const;
    const stats = { ...this.stats };
    for (const listener of this.listeners) listener(frame, stats);
    this.adjustAutoExposure(timestamp);
  }

  private adjustAutoExposure(timestamp: number) {
    if (!this.currentSettings.autoExposure || timestamp - this.lastAutoExposureAt < 500) return;
    const white = this.stats.whitePixelsPercent;
    let nextExposure = this.currentSettings.exposureMicroseconds;
    if (white === 0) nextExposure += 10;
    else if (white > 5) nextExposure -= Math.floor(white / 4) * 20;
    nextExposure = Math.min(600, Math.max(0, nextExposure));
    if (nextExposure === this.currentSettings.exposureMicroseconds) return;
    this.lastAutoExposureAt = timestamp;
    this.currentSettings = { ...this.currentSettings, exposureMicroseconds: nextExposure };
    this.stats.exposureMicroseconds = nextExposure;
    this.pollQueue = this.pollQueue
      .then(async () => {
        if (!this.running || !this.streaming) return;
        await this.transport.sendSubcommand(SUBCOMMAND_SET_MCU_CONFIG, [
          ...buildExposureRegisterConfig(nextExposure),
        ]);
      })
      .catch((error) => this.record(`auto exposure failed: ${describe(error)}`));
  }

  private queueAcknowledgement(acknowledgement: IrAcknowledgement) {
    this.pollQueue = this.pollQueue
      .then(async () => {
        if (!this.running || !this.streaming) return;
        await this.transport.sendMcuCommand(
          MCU_COMMAND_SET_REPORT_MODE,
          buildAcknowledgementPoll(acknowledgement, this.assembler.fragmentCount)
        );
      })
      .catch((error) => {
        this.record(`acknowledgement failed: ${describe(error)}`);
        this.streaming = false;
      });
  }

  private createInputWaiter(predicate: InputWaiter['predicate'], timeoutMs: number) {
    let waiter: InputWaiter;
    const promise = new Promise<HIDInputReportEvent>((resolve, reject) => {
      waiter = {
        predicate,
        resolve,
        reject,
        timeout: window.setTimeout(() => {
          this.finishWaiter(waiter);
          reject(new Error('The Joy-Con IR processor did not reply in time.'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
    return {
      promise,
      cancel: () => {
        if (!waiter!) return;
        this.finishWaiter(waiter);
      },
    };
  }

  private finishWaiter(waiter: InputWaiter) {
    window.clearTimeout(waiter.timeout);
    this.waiters.delete(waiter);
  }

  private record(message: string) {
    const elapsed = Math.round(performance.now() - this.startedAt);
    if (this.log.length >= MAX_DIAGNOSTIC_LINES) this.log.shift();
    this.log.push(`+${elapsed}ms ${message}`);
  }

  private async restoreStandardMode() {
    this.streaming = false;
    this.running = false;
    for (const waiter of [...this.waiters]) {
      this.finishWaiter(waiter);
      waiter.reject(new Error('The IR camera stopped.'));
    }
    await this.pollQueue.catch(() => undefined);
    this.pollQueue = Promise.resolve();

    try {
      if (this.transport.device) {
        await this.transport.transactSubcommand(SUBCOMMAND_SET_MCU_STATE, [0x00]);
      }
    } catch {
      // Restoring standard input remains useful even if the MCU is already unavailable.
    }
    try {
      if (this.transport.device) {
        await this.transport.transactSubcommand(SUBCOMMAND_SET_INPUT_MODE, [
          INPUT_REPORT_STANDARD_FULL,
        ]);
      }
    } catch {
      // A physical disconnect is handled by the controller hook.
    }
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    this.assembler.reset();
  }
}

function isImageTransferStatus(reply: Uint8Array) {
  return reply[0] === MCU_ACK_REGISTERS_SET && reply[2] === IR_MODE_IMAGE_TRANSFER;
}

/** Extracts the MCU payload of a subcommand reply, or null when the report is unrelated. */
function readSubcommandReply(event: HIDInputReportEvent, subcommand: number) {
  if (event.reportId !== INPUT_REPORT_SUBCOMMAND_REPLY) return null;
  if (event.data.byteLength <= SUBCOMMAND_REPLY_OFFSET) return null;
  if (event.data.getUint8(SUBCOMMAND_ECHO_OFFSET) !== subcommand) return null;
  if ((event.data.getUint8(SUBCOMMAND_ACK_OFFSET) & 0x80) === 0) return null;
  return new Uint8Array(
    event.data.buffer.slice(
      event.data.byteOffset + SUBCOMMAND_REPLY_OFFSET,
      event.data.byteOffset + event.data.byteLength
    )
  );
}

function format(reply: Uint8Array | null) {
  if (!reply) return 'none';
  return [...reply.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function emptyStats(
  exposureMicroseconds = DEFAULT_IR_SETTINGS.exposureMicroseconds
): IrStreamStats {
  return {
    receivedPackets: 0,
    completedFrames: 0,
    droppedFragments: 0,
    malformedPackets: 0,
    framesPerSecond: 0,
    lastFrameAt: null,
    averageIntensity: null,
    whitePixels: 0,
    whitePixelsPercent: 0,
    ambientNoisePixels: 0,
    ambientNoiseRatio: 0,
    externalFilterIntensity: 0,
    exposureMicroseconds,
  };
}

function createAssembler(settings: IrCameraSettings) {
  const mode = IR_RESOLUTION_MODES[settings.resolution];
  return new IrFrameAssembler(mode.width, mode.height, mode.fragmentCount);
}
