import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SolarJuiceError } from '../src/index.js';
import { jsonResponse, makeClient } from '../test-helpers/stub-fetch.js';

function cataloguePage(skus, nextCursor) {
  return jsonResponse({
    as_of: '2026-09-02T04:10:11Z',
    price_list_version: '2026-09-02T04:00:00Z',
    items: skus.map((sku) => ({ sku })),
    next_cursor: nextCursor,
  });
}

describe('list', () => {
  it('returns the envelope, not just the items', async () => {
    const { client } = makeClient([cataloguePage(['GW-5000-DNS-30'], 'cursor-2')]);

    const page = await client.catalogue.list({ limit: 1 });

    assert.equal(page.as_of, '2026-09-02T04:10:11Z');
    assert.equal(page.price_list_version, '2026-09-02T04:00:00Z');
    assert.equal(page.next_cursor, 'cursor-2');
    assert.deepEqual(page.items, [{ sku: 'GW-5000-DNS-30' }]);
  });
});

describe('autoPage', () => {
  it('walks next_cursor and yields items, not pages', async () => {
    const { client, calls } = makeClient([
      cataloguePage(['A', 'B'], 'cursor-2'),
      cataloguePage(['C'], 'cursor-3'),
      cataloguePage(['D'], null),
    ]);

    const skus = [];
    for await (const product of client.catalogue.autoPage({ brand: 'GoodWe' })) {
      skus.push(product.sku);
    }

    assert.deepEqual(skus, ['A', 'B', 'C', 'D']);
    assert.equal(calls.length, 3);

    // The first page must not carry a cursor, and the filter must survive.
    assert.equal(calls[0].query.has('cursor'), false);
    assert.equal(calls[1].query.get('cursor'), 'cursor-2');
    assert.equal(calls[2].query.get('cursor'), 'cursor-3');
    assert.equal(calls[2].query.get('brand'), 'GoodWe');
  });

  it('stops on an empty last page', async () => {
    const { client } = makeClient([cataloguePage([], null)]);

    const seen = [];
    for await (const product of client.catalogue.autoPage()) seen.push(product);

    assert.deepEqual(seen, []);
  });

  it('stops fetching as soon as the consumer breaks out', async () => {
    const { client, calls } = makeClient([cataloguePage(['A', 'B'], 'cursor-2')]);

    for await (const product of client.catalogue.autoPage()) {
      if (product.sku === 'A') break;
    }

    // A second page would have thrown from the stub, which has nothing queued.
    assert.equal(calls.length, 1);
  });

  it('raises rather than looping when the cursor stops moving', async () => {
    const { client } = makeClient([
      cataloguePage(['A'], 'cursor-2'),
      cataloguePage(['B'], 'cursor-2'),
    ]);

    await assert.rejects(async () => {
      for await (const _product of client.catalogue.autoPage()) {
        // Drain it; the guard should fire on the third page request.
      }
    }, (error) => {
      assert.ok(error instanceof SolarJuiceError);
      assert.equal(error.code, 'PAGINATION_STALLED');
      return true;
    });
  });

  it('is available on every list endpoint', async () => {
    const envelope = (items) => jsonResponse({ as_of: '2026-09-02T04:10:11Z', items, next_cursor: null });
    const { client } = makeClient([
      envelope([{ sku: 'A' }]),
      envelope([{ id: 'spc_1' }]),
      envelope([{ id: 'ord_1' }]),
    ]);

    const collect = async (generator) => {
      const out = [];
      for await (const item of generator) out.push(item);
      return out;
    };

    assert.equal((await collect(client.inventory.autoPage())).length, 1);
    assert.equal((await collect(client.specials.autoPage({ active: true }))).length, 1);
    assert.equal((await collect(client.orders.autoPage({ status: 'accepted' }))).length, 1);
  });
});
