import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NotFoundError, ValidationFailedError } from '../src/index.js';
import { errorResponse, jsonResponse, makeClient } from '../test-helpers/stub-fetch.js';

const WEBHOOK_ID = 'wh_01m24fj0js2r8nkr2pwhc6wykm';
const CREATE_BODY = {
  url: 'https://example.partner.com.au/hooks/solarjuice',
  events: ['catalogue.updated', 'specials.updated'],
  description: 'Production catalogue sync',
};

const endpoint = (fields = {}) => ({
  id: WEBHOOK_ID,
  channel_id: 'ch_01J6ZK3M5X8QW2R7Y9V4B1N0PD',
  url: CREATE_BODY.url,
  events: CREATE_BODY.events,
  status: 'active',
  created_at: '2026-09-11T05:12:40Z',
  updated_at: '2026-09-11T05:12:40Z',
  consecutive_failures: 0,
  ...fields,
});

describe('webhooks.list', () => {
  it('gets /v1/webhooks and returns the endpoints envelope', async () => {
    const { client, calls } = makeClient([jsonResponse({ endpoints: [endpoint()] })]);

    const page = await client.webhooks.list();

    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].path, '/v1/webhooks');
    assert.equal(page.endpoints[0].id, WEBHOOK_ID);
  });
});

describe('webhooks.create', () => {
  it('posts the body untouched and returns the secret', async () => {
    const { client, calls } = makeClient([
      jsonResponse(endpoint({ secret: 'whsec_test' }), { status: 201 }),
    ]);

    const created = await client.webhooks.create(CREATE_BODY);

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, '/v1/webhooks');
    assert.deepEqual(calls[0].body, CREATE_BODY);
    assert.equal(created.secret, 'whsec_test');
  });

  it('raises when the API rejects the URL', async () => {
    const { client } = makeClient([errorResponse(422, 'VALIDATION_FAILED')], { maxRetries: 0 });

    await assert.rejects(client.webhooks.create({ ...CREATE_BODY, url: 'http://localhost/' }), ValidationFailedError);
  });
});

describe('webhooks.delete', () => {
  it('sends DELETE and resolves to undefined on a 204', async () => {
    const { client, calls } = makeClient([jsonResponse(null, { status: 204 })]);

    const result = await client.webhooks.delete(WEBHOOK_ID);

    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].path, `/v1/webhooks/${WEBHOOK_ID}`);
    assert.equal(result, undefined);
  });

  it('raises for an endpoint that is not this channel', async () => {
    const { client } = makeClient([errorResponse(404, 'NOT_FOUND')], { maxRetries: 0 });

    await assert.rejects(client.webhooks.delete('wh_00000000000000000000000000'), NotFoundError);
  });
});

describe('webhooks.enable', () => {
  it('posts to the enable route with no body and returns the endpoint', async () => {
    const { client, calls } = makeClient([jsonResponse(endpoint())]);

    const enabled = await client.webhooks.enable(WEBHOOK_ID);

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, `/v1/webhooks/${WEBHOOK_ID}/enable`);
    assert.equal(calls[0].body, undefined);
    assert.equal(enabled.status, 'active');
  });

  it('percent encodes the webhook id', async () => {
    const { client, calls } = makeClient([jsonResponse(endpoint())]);

    await client.webhooks.enable('wh/1');

    assert.equal(calls[0].path, '/v1/webhooks/wh%2F1/enable');
  });
});

describe('webhooks.test', () => {
  it('posts to the test route and returns the queued receipt', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ queued: true, event: 'webhook.test' }, { status: 202 }),
    ]);

    const receipt = await client.webhooks.test(WEBHOOK_ID);

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, `/v1/webhooks/${WEBHOOK_ID}/test`);
    assert.equal(calls[0].body, undefined);
    assert.equal(receipt.queued, true);
  });

  it('raises when the endpoint is disabled', async () => {
    const { client } = makeClient([errorResponse(422, 'VALIDATION_FAILED')], { maxRetries: 0 });

    await assert.rejects(client.webhooks.test(WEBHOOK_ID), ValidationFailedError);
  });
});
