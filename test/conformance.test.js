import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../src/index.js';
import { readSpec } from '../test-helpers/spec.js';
import { jsonResponse, makeClient } from '../test-helpers/stub-fetch.js';

/**
 * The spec is the contract. This test fails when the API grows an operation
 * the SDK does not implement, when a method is pointed at the wrong route, or
 * when the three places that carry the version drift apart.
 */

const SAMPLE = {
  sku: 'GW-5000-DNS-30',
  id: 'ord_01J6ZK3M5X8QW2R7Y9V4B1N0PD',
};

/**
 * Every operationId in spec/openapi.yaml, and the SDK call that serves it.
 *
 * `path` is filled in from the spec, so an entry cannot silently disagree with
 * the document about the route it is meant to hit.
 */
const IMPLEMENTATIONS = {
  listCatalogue: { call: 'catalogue.list()', invoke: (client) => client.catalogue.list() },
  getCatalogueProduct: { call: 'catalogue.get(sku)', invoke: (client) => client.catalogue.get(SAMPLE.sku) },
  listInventory: { call: 'inventory.list()', invoke: (client) => client.inventory.list() },
  getInventoryItem: { call: 'inventory.get(sku)', invoke: (client) => client.inventory.get(SAMPLE.sku) },
  listSpecials: { call: 'specials.list()', invoke: (client) => client.specials.list() },
  createShippingQuote: { call: 'shipping.quote(body)', invoke: (client) => client.shipping.quote({ destination: {}, lines: [] }) },
  createOrder: { call: 'orders.create(body)', invoke: (client) => client.orders.create({ client_reference: 'PO-88213' }) },
  listOrders: { call: 'orders.list()', invoke: (client) => client.orders.list() },
  getOrder: { call: 'orders.get(id)', invoke: (client) => client.orders.get(SAMPLE.id) },
  cancelOrder: { call: 'orders.cancel(id)', invoke: (client) => client.orders.cancel(SAMPLE.id) },
  getHealth: { call: 'health()', invoke: (client) => client.health() },
};

/** List operations that must also offer the auto-paginating variant. */
const AUTO_PAGED = [
  ['listCatalogue', 'catalogue'],
  ['listInventory', 'inventory'],
  ['listSpecials', 'specials'],
  ['listOrders', 'orders'],
];

const spec = readSpec();

/** Fill `{sku}` style placeholders with the values the invocations use. */
function concretePath(template) {
  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = SAMPLE[name];
    assert.ok(value, `no sample value for path parameter ${name}`);
    return encodeURIComponent(value);
  });
}

describe('spec conformance', () => {
  it('found the operations in the spec', () => {
    assert.ok(spec.operations.size >= 10, 'the spec reader found no operations');
  });

  it('implements every operationId in the spec', () => {
    const missing = [...spec.operations.keys()].filter((id) => !(id in IMPLEMENTATIONS));
    assert.deepEqual(missing, [], `operations in the spec with no SDK method: ${missing.join(', ')}`);
  });

  it('has no SDK method for an operation the spec does not define', () => {
    const extra = Object.keys(IMPLEMENTATIONS).filter((id) => !spec.operations.has(id));
    assert.deepEqual(extra, [], `SDK methods claiming operations that are not in the spec: ${extra.join(', ')}`);
  });

  for (const [operationId, { call, invoke }] of Object.entries(IMPLEMENTATIONS)) {
    it(`${operationId} is ${call} on ${describeRoute(operationId)}`, async () => {
      const route = spec.operations.get(operationId);
      assert.ok(route, `${operationId} is not in the spec`);

      const { client, calls } = makeClient([
        jsonResponse({ status: 'ok', items: [], next_cursor: null }, { status: route.method === 'POST' ? 202 : 200 }),
      ]);

      await invoke(client);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, route.method);
      assert.equal(calls[0].path, concretePath(route.path));
    });
  }

  for (const [operationId, resource] of AUTO_PAGED) {
    it(`${operationId} also has ${resource}.autoPage`, async () => {
      const { client } = makeClient([jsonResponse({ items: [{ sku: SAMPLE.sku }], next_cursor: null })]);

      const seen = [];
      for await (const item of client[resource].autoPage()) seen.push(item);

      assert.deepEqual(seen, [{ sku: SAMPLE.sku }]);
    });
  }
});

describe('version', () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  );

  it('matches the spec and package.json', () => {
    assert.equal(VERSION, spec.version, 'src/version.js and spec/openapi.yaml disagree');
    assert.equal(VERSION, packageJson.version, 'src/version.js and package.json disagree');
  });
});

function describeRoute(operationId) {
  const route = spec.operations.get(operationId);
  return route ? `${route.method} ${route.path}` : 'a route the spec does not define';
}
