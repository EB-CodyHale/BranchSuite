/** Small, auditable crypto helpers (node:crypto only). */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison of two strings (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Uniform random string over `alphabet`. */
export function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Uniform float in [0, 1) from the CSPRNG (for shared functions that take an rng). */
export function secureRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

/** Opaque, stable wall key for an order: HMAC-SHA256(secret, branchId:orderId), base64url, 16 chars. */
export function wallOrderKey(secret: Buffer, branchId: string, orderId: string): string {
  return createHmac('sha256', secret).update(`${branchId}:${orderId}`, 'utf8').digest('base64url').slice(0, 16);
}

const PAIRING_KEY_INFO = 'branchsuite/pairing-token/v1';

function pairingKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), PAIRING_KEY_INFO, 32));
}

/**
 * AES-256-GCM with a key derived (HKDF) from the wall secret. `context` is bound as AAD so a
 * ciphertext cannot be replayed onto another record. Output: iv.tag.ciphertext (base64url).
 */
export function seal(secret: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', pairingKey(secret), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

/** Inverse of seal. Throws when the ciphertext, key or context does not match. */
export function open(secret: Buffer, sealed: string, context: string): string {
  const [iv, tag, ct] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !ct) throw new Error('Malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', pairingKey(secret), iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
