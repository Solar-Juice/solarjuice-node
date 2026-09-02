import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ForbiddenError,
  IdempotencyConflictError,
  InternalError,
  NotFoundError,
  PriceChangedError,
  QuoteUnavailableError,
  RateLimitedError,
  SolarJuiceError,
  StaleDataError,
  UnauthorizedError,
  ValidationFailedError,
} from '../src/index.js';
import { jsonResponse, makeClient } from '../test-helpers/stub-fetch.js';

/**
 * The cross SDK response mapping table.
 *
 * test-fixtures/error-mapping.json is shared verbatim with the PHP and Ruby
 * clients: one response in, one decision out. The contract says the three
 * behave identically for the same inputs, and this is what makes a divergence
 * fail a test here rather than surface in a partner integration.
 */

const TABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test-fixtures/error-mapping.json', import.meta.url)), 'utf8'),
);

/** The table's language neutral names, mapped onto this SDK's classes. */
const ERROR_CLASSES = {
  Base: SolarJuiceError,
  Unauthorized: UnauthorizedError,
  Forbidden: ForbiddenError,
  NotFound: NotFoundError,
  ValidationFailed: ValidationFailedError,
  RateLimited: RateLimitedError,
  PriceChanged: PriceChangedError,
  IdempotencyConflict: IdempotencyConflictError,
  QuoteUnavailable: QuoteUnavailableError,
  StaleData: StaleDataError,
  Internal: InternalError,
};

function responseFor({ status, headers, body }) {
  // 204 and 304 must be constructed with a null body or the Response
  // constructor refuses them.
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

describe('shared error mapping table', () => {
  it('names an error class this SDK has for every case', () => {
    const unknown = TABLE.cases
      .map((entry) => entry.expect.error)
      .filter((name) => name !== null && !(name in ERROR_CLASSES));

    assert.deepEqual([...new Set(unknown)], []);
  });

  for (const entry of TABLE.cases) {
    describe(`${entry.status}: ${entry.name}`, () => {
      it(`maps to ${entry.expect.error ?? 'no error'} with code ${entry.expect.code ?? 'null'}`, async () => {
        const { client } = makeClient([() => responseFor(entry)], { maxRetries: 0 });
        const call = client.catalogue.list();

        if (entry.expect.error === null) {
          await call;
          return;
        }

        await assert.rejects(call, (error) => {
          const Expected = ERROR_CLASSES[entry.expect.error];
          assert.ok(error instanceof Expected, `expected ${Expected.name}, got ${error.name}`);
          // Exact class, not just the ancestry: Base must not stand in for a
          // subclass, and a subclass must not stand in for Base.
          assert.equal(error.constructor, Expected, `expected exactly ${Expected.name}, got ${error.name}`);
          assert.equal(error.code, entry.expect.code);
          assert.equal(error.statusCode, entry.status);

          if ('retry_after_seconds' in entry.expect) {
            assert.equal(error.retryAfter, entry.expect.retry_after_seconds);
          }
          return true;
        });
      });

      it(`is ${entry.expect.retried ? 'retried' : 'not retried'}`, async () => {
        const { client, calls } = makeClient(
          [() => responseFor(entry), jsonResponse({ as_of: '2026-09-02T04:10:11Z', items: [], next_cursor: null })],
          { maxRetries: 1 },
        );

        await client.catalogue.list().catch(() => {});

        assert.equal(calls.length, entry.expect.retried ? 2 : 1);
      });
    });
  }
});
