import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NotFoundError, ValidationFailedError } from '../src/index.js';
import { uuidv4 } from '../src/uuid.js';
import { errorResponse, jsonResponse, makeClient, notModifiedResponse } from '../test-helpers/stub-fetch.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ORDER_ID = 'ord_01J6ZK3M5X8QW2R7Y9V4B1N0PD';
const ORDER_BODY = {
  client_reference: 'PO-88213',
  price_list_version: '2026-09-02T04:00:00Z',
  quote_id: 'qte_01J6ZK3M5X8QW2R7Y9V4B1N0PD',
  rate_service_code: 'ALLIED-GENERAL',
  delivery: { name: 'Jane Citizen', phone: '+61400000000', address1: '12 Example Street', suburb: 'Parramatta', postcode: '2150', state: 'NSW' },
  lines: [{ sku: 'GW-5000-DNS-30', quantity: 1, unit_price: '1110.99' }],
};

const receipt = () => jsonResponse({ id: ORDER_ID, status: 'received' }, { status: 202 });

describe('uuidv4', () => {
  it('sets the version and variant bits', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(uuidv4(), UUID_V4);
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => uuidv4()));
    assert.equal(seen.size, 1000);
  });
});

describe('orders.create', () => {
  it('generates an Idempotency-Key when the caller does not supply one', async () => {
    const { client, calls } = makeClient([receipt()]);

    const order = await client.orders.create(ORDER_BODY);

    const sent = calls[0].headers['Idempotency-Key'];
    assert.match(sent, UUID_V4);
    // The caller has to be able to log the key that was actually used.
    assert.equal(order.idempotencyKey, sent);
  });

  it('uses the caller key when given one', async () => {
    const { client, calls } = makeClient([receipt()]);

    const order = await client.orders.create(ORDER_BODY, { idempotencyKey: 'PO-88213-attempt-2' });

    assert.equal(calls[0].headers['Idempotency-Key'], 'PO-88213-attempt-2');
    assert.equal(order.idempotencyKey, 'PO-88213-attempt-2');
  });

  it('generates a fresh key per call', async () => {
    const { client, calls } = makeClient([receipt(), receipt()]);

    await client.orders.create(ORDER_BODY);
    await client.orders.create({ ...ORDER_BODY, client_reference: 'PO-88214' });

    assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  });

  it('posts the body untouched to /v1/orders', async () => {
    const { client, calls } = makeClient([receipt()]);

    await client.orders.create(ORDER_BODY);

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, '/v1/orders');
    assert.deepEqual(calls[0].body, ORDER_BODY);
  });
});

describe('orders.get', () => {
  it('returns the order and records its ETag', async () => {
    const { client } = makeClient([
      jsonResponse({ id: ORDER_ID, status: 'processing' }, { headers: { ETag: '"a1b2c3d4e5f6"' } }),
    ]);

    const order = await client.orders.get(ORDER_ID);

    assert.equal(order.status, 'processing');
    assert.equal(client.lastEtag, '"a1b2c3d4e5f6"');
  });

  it('sends If-None-Match and returns null on 304', async () => {
    const { client, calls } = makeClient([notModifiedResponse('"a1b2c3d4e5f6"')]);

    const order = await client.orders.get(ORDER_ID, { ifNoneMatch: '"a1b2c3d4e5f6"' });

    assert.equal(calls[0].headers['If-None-Match'], '"a1b2c3d4e5f6"');
    assert.equal(order, null);
    assert.equal(client.lastEtag, '"a1b2c3d4e5f6"');
  });

  it('omits If-None-Match when no ETag is given', async () => {
    const { client, calls } = makeClient([jsonResponse({ id: ORDER_ID })]);

    await client.orders.get(ORDER_ID);

    assert.equal('If-None-Match' in calls[0].headers, false);
  });

  it('still raises for a missing order, so null only ever means not modified', async () => {
    const { client } = makeClient([errorResponse(404, 'NOT_FOUND')], { maxRetries: 0 });

    await assert.rejects(client.orders.get('ord_00000000000000000000000000'), NotFoundError);
  });
});

describe('orders.cancel', () => {
  const cancelled = () => jsonResponse({ id: ORDER_ID, status: 'cancelled' });

  it('posts to the cancel route and returns the updated order', async () => {
    const { client, calls } = makeClient([cancelled()]);

    const order = await client.orders.cancel(ORDER_ID);

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, `/v1/orders/${ORDER_ID}/cancel`);
    assert.equal(order.status, 'cancelled');
  });

  it('sends no body when there is no note, because the body is optional', async () => {
    const { client, calls } = makeClient([cancelled()]);

    await client.orders.cancel(ORDER_ID);

    assert.equal(calls[0].body, undefined);
    assert.equal('Content-Type' in calls[0].headers, false);
  });

  it('sends the note when one is given', async () => {
    const { client, calls } = makeClient([cancelled()]);

    await client.orders.cancel(ORDER_ID, { note: 'Customer changed the panel selection' });

    assert.deepEqual(calls[0].body, { note: 'Customer changed the panel selection' });
  });

  it('percent encodes the order id', async () => {
    const { client, calls } = makeClient([cancelled()]);

    await client.orders.cancel('ord/1');

    assert.equal(calls[0].path, '/v1/orders/ord%2F1/cancel');
  });

  it('raises when the order is past the point a partner can cancel it', async () => {
    const { client } = makeClient([errorResponse(422, 'VALIDATION_FAILED')], { maxRetries: 0 });

    await assert.rejects(client.orders.cancel(ORDER_ID), ValidationFailedError);
  });
});

describe('orders.list', () => {
  it('passes the documented filters through', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ as_of: '2026-09-02T04:21:02Z', items: [], next_cursor: null }),
    ]);

    await client.orders.list({ status: 'accepted', client_reference: 'PO-88213', limit: 25 });

    const { query } = calls[0];
    assert.equal(query.get('status'), 'accepted');
    assert.equal(query.get('client_reference'), 'PO-88213');
    assert.equal(query.get('limit'), '25');
  });
});
