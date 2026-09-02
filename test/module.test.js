import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The package is ES modules, but Node 22.12 and later let CommonJS require()
 * an ES module as long as its graph has no top-level await. A single
 * `await import()` at module scope anywhere in the graph turns every
 * require() of the package into ERR_REQUIRE_ASYNC_MODULE, and bundlers
 * emitting CommonJS refuse it for the same reason.
 */

const ENTRY_POINT = fileURLToPath(new URL('../src/index.js', import.meta.url));

describe('CommonJS interoperability', () => {
  const supportsRequireOfEsm = process.features.require_module === true;

  it('is require()able from CommonJS, so the graph has no top-level await', { skip: supportsRequireOfEsm ? false : 'this Node does not support require() of an ES module' }, () => {
    const script = `
      const sdk = require(${JSON.stringify(ENTRY_POINT)});
      if (typeof sdk.SolarJuiceClient !== 'function') throw new Error('no SolarJuiceClient export');
      process.stdout.write(sdk.VERSION);
    `;

    const version = execFileSync(process.execPath, ['--eval', script, '--input-type=commonjs'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.match(version, /^\d+\.\d+\.\d+$/);
  });

  it('falls back to node:crypto when there is no Web Crypto global, as on Node 18', () => {
    // The fallback branch cannot be exercised in process on a runtime that has
    // the global, so take the global away in a child.
    const script = `
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const { uuidv4 } = await import(${JSON.stringify(new URL('../src/uuid.js', import.meta.url).href)});
      process.stdout.write(uuidv4());
    `;

    const uuid = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates a UUID without a top-level await anywhere in the crypto lookup', async () => {
    // Importing the module and using it in the same tick is what a bundled
    // CommonJS consumer does; a lazily resolved source must still be there.
    const { uuidv4 } = await import('../src/uuid.js');
    assert.match(uuidv4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
