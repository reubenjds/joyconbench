import { WebHIDTransport } from '../hid/WebHIDTransport';
import {
  INPUT_REPORT_NFC_IR,
  INPUT_REPORT_STANDARD_FULL,
  MCU_COMMAND_GET_STATE,
  MCU_COMMAND_SET_REPORT_MODE,
  SUBCOMMAND_SET_INPUT_MODE,
  SUBCOMMAND_SET_MCU_CONFIG,
  SUBCOMMAND_SET_MCU_STATE,
} from '../protocol/nintendo';
import {
  IR_HEIGHT,
  IR_WIDTH,
  MCU_MODE_OFFSET,
  MCU_REPORT_OFFSET,
  MCU_REPORT_STATE,
  IrFrameAssembler,
  buildIrFragmentPoll,
  buildIrHandshakePoll,
  buildIrModeConfig,
  buildIrRegisterConfig,
  buildMcuModeConfig,
  parseIrFragment,
} from '../protocol/ir';
import type {
  ControllerKind,
  IrCameraCapability,
  IrFrameListener,
  IrStreamStats,
} from '../types/controller';

const MCU_MODE_IR = 0x05;

interface InputWaiter {
  predicate: (event: HIDInputReportEvent) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
}

export class NintendoIrCamera implements IrCameraCapability {
  private readonly listeners = new Set<IrFrameListener>();
  private readonly waiters = new Set<InputWaiter>();
  private readonly assembler = new IrFrameAssembler();
  private unsubscribeTransport: (() => void) | null = null;
  private running = false;
  private streaming = false;
  private sequence = 0;
  private pollQueue: Promise<void> = Promise.resolve();
  private frameTimes: number[] = [];
  private stats = emptyStats();

  constructor(
    private readonly transport: WebHIDTransport,
    private readonly controllerKind: () => ControllerKind | null
  ) {}

  async start() {
    if (this.controllerKind() !== 'joycon-right') {
      throw new Error('The IR camera is available only on an original right Joy-Con.');
    }
    if (this.running) return;

    this.running = true;
    this.streaming = false;
    this.sequence = 0;
    this.stats = emptyStats();
    this.frameTimes = [];
    this.assembler.reset();
    this.unsubscribeTransport = this.transport.subscribe(this.handleInputReport);

    try {
      await this.transport.transactSubcommand(SUBCOMMAND_SET_INPUT_MODE, [INPUT_REPORT_NFC_IR]);
      await this.transport.transactSubcommand(SUBCOMMAND_SET_MCU_STATE, [0x01]);
      const modeReply = await this.transport.transactSubcommand(SUBCOMMAND_SET_MCU_CONFIG, [
        ...buildMcuModeConfig(),
      ]);
      if (!this.isMcuModeReply(modeReply, MCU_MODE_IR)) {
        await this.waitForMcuMode(MCU_MODE_IR);
      }
      await this.configureUntil(buildIrModeConfig(), (reply) => reply[0] === 0x0b);
      await this.configureRegisters(1);
      await this.configureRegisters(2);
      this.streaming = true;
      await this.transport.sendMcuCommand(MCU_COMMAND_SET_REPORT_MODE, buildIrFragmentPoll(0));
    } catch (error) {
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

  subscribe(listener: IrFrameListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async configureRegisters(step: 1 | 2) {
    const payload = buildIrRegisterConfig(step);
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const reply = await this.transport.transactSubcommand(SUBCOMMAND_SET_MCU_CONFIG, [
        ...payload,
      ]);
      if (step === 1 && attempt === 0) {
        await this.transport.sendMcuCommand(MCU_COMMAND_SET_REPORT_MODE, buildIrHandshakePoll());
      }
      if (reply[0] === 0x23 || (reply[0] === 0x13 && (step === 2 || reply[2] === 0x07))) return;
    }
    throw new Error(`IR register configuration step ${step} timed out.`);
  }

  private async configureUntil(payload: Uint8Array, accepted: (reply: Uint8Array) => boolean) {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const reply = await this.transport.transactSubcommand(SUBCOMMAND_SET_MCU_CONFIG, [
        ...payload,
      ]);
      if (accepted(reply)) return;
    }
    throw new Error('IR image-transfer configuration timed out.');
  }

  private async waitForMcuMode(mode: number) {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const waiter = this.createInputWaiter(
        (event) =>
          event.reportId === INPUT_REPORT_NFC_IR &&
          event.data.byteLength > MCU_MODE_OFFSET &&
          event.data.getUint8(MCU_REPORT_OFFSET) === MCU_REPORT_STATE &&
          event.data.getUint8(MCU_MODE_OFFSET) === mode,
        500
      );
      try {
        await this.transport.sendMcuCommand(MCU_COMMAND_GET_STATE, new Uint8Array(38));
        await waiter.promise;
        return;
      } catch {
        waiter.cancel();
      }
    }
    throw new Error('The Joy-Con IR processor did not enter the expected mode.');
  }

  private isMcuModeReply(reply: Uint8Array, mode: number) {
    return reply.length > 7 && reply[0] === MCU_REPORT_STATE && reply[7] === mode;
  }

  private readonly handleInputReport = (event: HIDInputReportEvent) => {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(event)) continue;
      this.finishWaiter(waiter);
      waiter.resolve();
    }
    if (!this.streaming || event.reportId !== INPUT_REPORT_NFC_IR) return;
    if (
      event.data.byteLength <= MCU_REPORT_OFFSET ||
      event.data.getUint8(MCU_REPORT_OFFSET) !== 3
    ) {
      return;
    }

    this.stats.receivedPackets += 1;
    const fragment = parseIrFragment(event.data);
    if (!fragment) {
      this.stats.malformedPackets += 1;
      this.queuePoll(this.assembler.nextFragment, true);
      return;
    }
    const result = this.assembler.accept(fragment);
    this.stats.droppedFragments += result.droppedFragments;
    if (result.frame) this.publishFrame(result.frame);
    this.queuePoll(result.nextFragment, result.resend);
  };

  private publishFrame(pixels: Uint8Array) {
    const timestamp = performance.now();
    this.frameTimes.push(timestamp);
    this.frameTimes = this.frameTimes.filter((value) => timestamp - value <= 5000);
    this.stats.completedFrames += 1;
    this.stats.lastFrameAt = timestamp;
    if (this.frameTimes.length > 1) {
      const seconds = (timestamp - this.frameTimes[0]) / 1000;
      this.stats.framesPerSecond = seconds > 0 ? (this.frameTimes.length - 1) / seconds : 0;
    }
    const frame = {
      timestamp,
      sequence: this.sequence++,
      width: IR_WIDTH,
      height: IR_HEIGHT,
      pixels,
    } as const;
    const stats = { ...this.stats };
    for (const listener of this.listeners) listener(frame, stats);
  }

  private queuePoll(fragment: number, resend: boolean) {
    this.pollQueue = this.pollQueue
      .then(async () => {
        if (!this.running || !this.streaming) return;
        await this.transport.sendMcuCommand(
          MCU_COMMAND_SET_REPORT_MODE,
          buildIrFragmentPoll(fragment, resend)
        );
      })
      .catch(() => {
        this.streaming = false;
      });
  }

  private createInputWaiter(predicate: InputWaiter['predicate'], timeoutMs: number) {
    let waiter: InputWaiter;
    const promise = new Promise<void>((resolve, reject) => {
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

function emptyStats(): IrStreamStats {
  return {
    receivedPackets: 0,
    completedFrames: 0,
    droppedFragments: 0,
    malformedPackets: 0,
    framesPerSecond: 0,
    lastFrameAt: null,
  };
}
