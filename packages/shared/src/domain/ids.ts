/** Id helpers. Uses globalThis.crypto (Node >= 20 and browsers). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RANDOM_LENGTH = 22;

/** `${prefix}_${22-char url-safe random}` e.g. newId('ord'). */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  // 256 is a multiple of 64, so masking to 6 bits keeps every character equally likely (132 random bits).
  for (const b of bytes) out += ALPHABET[b & 63];
  return `${prefix}_${out}`;
}
