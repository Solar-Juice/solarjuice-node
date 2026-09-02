/**
 * RFC 4122 version 4 UUID built from cryptographically secure random bytes.
 *
 * Written out rather than calling crypto.randomUUID() so the SDK behaves the
 * same on any runtime with a Web Crypto global, including edge runtimes where
 * randomUUID is not always present.
 */
export function uuidv4() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
