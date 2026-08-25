export const INPUT_REPORT_STANDARD_FULL = 0x30;
export const INPUT_REPORT_SUBCOMMAND_REPLY = 0x21;

export const OUTPUT_REPORT_SUBCOMMAND = 0x01;
export const OUTPUT_REPORT_RUMBLE = 0x10;
export const OUTPUT_REPORT_USB = 0x80;

export const SUBCOMMAND_DEVICE_INFO = 0x02;
export const SUBCOMMAND_SET_INPUT_MODE = 0x03;
export const SUBCOMMAND_SPI_READ = 0x10;
export const SUBCOMMAND_SPI_WRITE = 0x11;
export const SUBCOMMAND_SET_PLAYER_LEDS = 0x30;
export const SUBCOMMAND_ENABLE_IMU = 0x40;
export const SUBCOMMAND_ENABLE_VIBRATION = 0x48;

export const SAFE_SUBCOMMANDS = new Set([
  SUBCOMMAND_DEVICE_INFO,
  SUBCOMMAND_SET_INPUT_MODE,
  SUBCOMMAND_SPI_READ,
  SUBCOMMAND_SPI_WRITE,
  SUBCOMMAND_SET_PLAYER_LEDS,
  SUBCOMMAND_ENABLE_IMU,
  SUBCOMMAND_ENABLE_VIBRATION,
]);

export const NO_RUMBLE = new Uint8Array([0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40]);
export const MAX_SPI_TRANSFER_BYTES = 0x1d;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function encodeMotor(lowFrequency: number, highFrequency: number, amplitude: number): Uint8Array {
  let low = clamp(lowFrequency, 40.875885, 626.286133);
  let high = clamp(highFrequency, 81.75177, 1252.572266);
  const strength = clamp(amplitude, 0, 1);

  high = (Math.round(32 * Math.log2(high * 0.1)) - 0x60) * 4;
  low = Math.round(32 * Math.log2(low * 0.1)) - 0x40;

  let highAmplitude: number;
  if (strength === 0) highAmplitude = 0;
  else if (strength < 0.117)
    highAmplitude = (Math.log2(strength * 1000) * 32 - 0x60) / (5 - strength ** 2) - 1;
  else if (strength < 0.23) highAmplitude = Math.log2(strength * 1000) * 32 - 0xbc;
  else highAmplitude = (Math.log2(strength * 1000) * 32 - 0x60) * 2 - 0xf6;

  let lowAmplitude = Math.round(highAmplitude) * 0.5;
  const parity = lowAmplitude % 2;
  if (parity > 0) lowAmplitude -= 1;
  lowAmplitude = (lowAmplitude >> 1) + 0x40;
  if (parity > 0) lowAmplitude |= 0x8000;

  return new Uint8Array([
    high & 0xff,
    Math.round(highAmplitude) + ((high >>> 8) & 0xff),
    low + ((lowAmplitude >>> 8) & 0xff),
    lowAmplitude & 0xff,
  ]);
}

export function encodeRumble(amplitude = 0.12): Uint8Array {
  const motor = encodeMotor(160, 320, amplitude);
  return new Uint8Array([...motor, ...motor]);
}

export function buildSubcommandPacket(counter: number, subcommand: number, payload: number[] = []) {
  if (!SAFE_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`Blocked unsafe Nintendo subcommand 0x${subcommand.toString(16)}`);
  }
  return new Uint8Array([counter & 0x0f, ...NO_RUMBLE, subcommand, ...payload]);
}

export function buildRumblePacket(counter: number, amplitude = 0.12) {
  return new Uint8Array([counter & 0x0f, ...encodeRumble(amplitude)]);
}
