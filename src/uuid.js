import { createRequire } from 'node:module';

/**
 * RFC 4122 version 4 UUID built from cryptographically secure random bytes.
 *
 * Written out rather than calling crypto.randomUUID() so the SDK behaves the
 * same on any runtime with a Web Crypto global, including edge runtimes where
 * randomUUID is not always present.
 */

/** Resolved on first use and kept, so the lookup happens at most once. */
let randomSource = null;

/**
 * The source of random bytes for this runtime.
 *
 * Resolved lazily and synchronously. Doing it at module scope needed a
 * top-level `await` for the Node 18 fallback, which makes `require()` of this
 * package fail outright on Node 22.12 and later (ERR_REQUIRE_ASYNC_MODULE) and
 * makes any bundler emitting CommonJS refuse the graph.
 */
function cryptoSource() {
  if (randomSource) return randomSource;

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    randomSource = globalThis.crypto;
    return randomSource;
  }

  /*
   * Node 18 only exposes the Web Crypto global under
   * --experimental-global-webcrypto, and it is a supported runtime here, so
   * fall back to the built-in module on that one case. Every other target
   * (Node 19 and later, Deno, Bun, workers) has the global, so this branch
   * never runs and nothing outside a Node process ever loads node:crypto.
   */
  randomSource = createRequire(import.meta.url)('node:crypto').webcrypto;
  return randomSource;
}

export function uuidv4() {
  const bytes = new Uint8Array(16);
  cryptoSource().getRandomValues(bytes);

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
