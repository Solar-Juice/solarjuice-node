# Solar Juice Partner API for Node.js

Official Node.js client for the [Solar Juice Partner API](https://dev.solarjuice.com.au).

The Partner API is for approved sales channels: a partner with a Solar Juice
trade account who sells Solar Juice stock through their own storefront. It
gives you your own price list, the sellable inventory the Solar Outlet
storefront sells from, the specials granted to your channel, freight quotes
from the same engine that prices the Solar Outlet checkout, and order placement
against your trade account. Everything you see is scoped to your channel.

- Developer program: https://dev.solarjuice.com.au
- API reference: https://dev.solarjuice.com.au/docs

## Requirements

Node 18 or later. No dependencies: the client is built on the global `fetch`
and `AbortSignal` that ship with the runtime.

## Install

```sh
npm install @solarjuice/partner-api
```

## Quickstart

```js
import { SolarJuiceClient } from '@solarjuice/partner-api';

const client = new SolarJuiceClient(); // reads SOLARJUICE_API_KEY

const { items, price_list_version } = await client.catalogue.list({ limit: 10 });
console.log(items[0].sku, items[0].price, price_list_version);

const stock = await client.inventory.get(items[0].sku);
console.log(stock.total, stock.available);
```

## Authentication

Keys look like `sj_live_<keyid>_<secret>` or `sj_test_<keyid>_<secret>` and are
sent as `Authorization: Bearer <key>`. There is one host: a test key runs
against the same catalogue, prices and inventory as a live key, and the only
difference is that orders placed with it are flagged `sandbox: true` and never
reach operations. Build against a test key, then swap in the live key with no
other change.

The client reads `SOLARJUICE_API_KEY` from the environment when you do not pass
a key, and raises `ConfigurationError` when there is no key either way.

```js
const client = new SolarJuiceClient({
  apiKey: process.env.SOLARJUICE_API_KEY, // default
  baseUrl: 'https://api.solarjuice.com.au', // default
  timeout: 30, // seconds per attempt
  maxRetries: 3,
  userAgent: 'acme-storefront/2.1', // appended to the SDK User-Agent
});
```

Keep the key in a secrets manager. It is shown once when it is issued and can
be revoked at any time.

## Resources

| Call | Endpoint |
|---|---|
| `client.catalogue.list(params)` | `GET /v1/catalogue` |
| `client.catalogue.get(sku)` | `GET /v1/catalogue/{sku}` |
| `client.inventory.list(params)` | `GET /v1/inventory` |
| `client.inventory.get(sku)` | `GET /v1/inventory/{sku}` |
| `client.specials.list(params)` | `GET /v1/specials` |
| `client.shipping.quote(body)` | `POST /v1/shipping/quotes` |
| `client.orders.create(body, options)` | `POST /v1/orders` |
| `client.orders.list(params)` | `GET /v1/orders` |
| `client.orders.get(id, options)` | `GET /v1/orders/{id}` |
| `client.health()` | `GET /v1/health` |

Every list call also has an `autoPage()` variant. Money is a decimal string
with two places, never a float, and is ex GST unless the field name says
otherwise. Timestamps are UTC ISO 8601.

## Pagination

`list()` returns the envelope the API sends, so you can read `as_of` and
`price_list_version` alongside the items:

```js
const page = await client.catalogue.list({ limit: 500, brand: 'GoodWe' });
// { as_of, price_list_version, items: [...], next_cursor }
```

`autoPage()` walks `next_cursor` for you and yields each item, which is what
you want for a full sync:

```js
for await (const product of client.catalogue.autoPage({ category: 'Panel' })) {
  await upsert(product);
}
```

Cursors are opaque and are bound to the query they were issued with, so do not
change `limit` or a filter part way through. To sync incrementally, keep the
`as_of` from your last response and pass it back as `updated_since`:

```js
const first = await client.catalogue.list();
// later
for await (const changed of client.catalogue.autoPage({ updated_since: first.as_of })) {
  await upsert(changed);
}
```

Inventory rows that have dropped to zero come back from an `updated_since`
query with `total: 0`, so you can clear them.

## Placing an order

An order needs a price list version, an unexpired `priced` quote and the
current channel price on every line.

```js
const catalogue = await client.catalogue.list({ brand: 'GoodWe' });
const product = catalogue.items[0];

const quote = await client.shipping.quote({
  destination: { suburb: 'Parramatta', postcode: '2150', state: 'NSW', address_type: 'residential' },
  lines: [{ sku: product.sku, quantity: 1 }],
});

if (quote.quote_status !== 'priced') {
  throw new Error(`Freight needs a human: ${quote.quote_status}, quote ${quote.quote_id}`);
}

const order = await client.orders.create({
  client_reference: 'PO-88213',
  price_list_version: catalogue.price_list_version,
  quote_id: quote.quote_id,
  rate_service_code: quote.rates[0].service_code,
  delivery: {
    name: 'Jane Citizen',
    phone: '+61400000000',
    address1: '12 Example Street',
    suburb: 'Parramatta',
    postcode: '2150',
    state: 'NSW',
  },
  lines: [{ sku: product.sku, quantity: 1, unit_price: product.price }],
});

console.log(order.id, order.status); // ord_..., "received"
```

Totals on the response are computed by the API and are authoritative.

### Idempotency

`client_reference` in the body is the only idempotency key. The same reference
with the same body returns the order that already exists (`200` rather than the
first call's `202`); the same reference with a different body raises
`IdempotencyConflictError`. Sandbox and live keys have separate reference
namespaces.

```js
const order = await client.orders.create({ client_reference: 'PO-88213', ...rest });
```

`orders.create` also sends an `Idempotency-Key` header, yours if you pass
`idempotencyKey` and a generated UUID v4 otherwise, and reports it back as
`order.idempotencyKey`. The API accepts that header and ignores it: it is not
stored, not compared and not returned, so it is a local correlation value for
your own logs and nothing more. Do not rely on it to deduplicate or to
reconcile a create that timed out. To find an order again after a timeout,
list by your own reference:

```js
const { items } = await client.orders.list({ client_reference: 'PO-88213' });
```

### Polling an order

Validation and acceptance are synchronous: a created order is already
`accepted`. What you are polling for is fulfilment, which operations drive.
Poll with the ETag from the previous fetch and an unchanged order costs you a
small `304` instead of a full body. The client
returns `null` for a `304` rather than raising, because not modified is a
normal polling outcome:

```js
let etag;
for (;;) {
  const current = await client.orders.get(order.id, { ifNoneMatch: etag });
  etag = client.lastEtag;

  if (current && ['dispatched', 'cancelled', 'rejected'].includes(current.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
```

A missing order still raises `NotFoundError`, so `null` only ever means "not
modified". Polling every order at once with
`client.orders.list({ updated_since })` is cheaper again.

## Errors

Everything the client throws extends `SolarJuiceError`, which carries `code`,
`message`, `details`, `requestId` and `statusCode`. There is a subclass per
documented error code:

| Class | Code | HTTP |
|---|---|---|
| `UnauthorizedError` | `UNAUTHORIZED` | 401 |
| `ForbiddenError` | `FORBIDDEN` | 403 |
| `NotFoundError` | `NOT_FOUND` | 404 |
| `ValidationFailedError` | `VALIDATION_FAILED` | 422 |
| `RateLimitedError` | `RATE_LIMITED` | 429 |
| `PriceChangedError` | `PRICE_CHANGED` | 409 |
| `IdempotencyConflictError` | `IDEMPOTENCY_CONFLICT` | 409 |
| `QuoteUnavailableError` | `QUOTE_UNAVAILABLE` | 503 |
| `StaleDataError` | `STALE_DATA` | 503 |
| `InternalError` | `INTERNAL` | 500 |

`TransportError` covers a request that never produced a response, with
`TimeoutError` for the client timeout, and `ConfigurationError` covers a client
built without a key. An error code this release does not know is carried
through on the base `SolarJuiceError` with its `code` intact, because the API
documents the enumeration as open.

```js
import { PriceChangedError, RateLimitedError } from '@solarjuice/partner-api';

try {
  await client.orders.create(body);
} catch (error) {
  if (error instanceof PriceChangedError) {
    // details carries the submitted and current values per line
    console.error(error.details);
    await refreshCatalogueAndResubmit();
  } else if (error instanceof RateLimitedError) {
    console.error(`Back off for ${error.retryAfter}s`);
  } else {
    console.error(`Request ${error.requestId} failed: ${error.code}`);
    throw error;
  }
}
```

Quote `error.requestId` in support requests. It is the `X-Request-Id` of the
failing call.

## Retries

The client retries 429, 502, 503 and 504 responses and network or timeout
failures, up to `maxRetries` (default 3). Backoff is exponential with full
jitter, starting at 500ms and capped at 8s, and a `Retry-After` header is
honoured in preference to the computed delay. Other 4xx responses are not
retried, because they will fail the same way twice.

`GET` and both `POST` endpoints are safe to retry: quotes have no side effects,
and orders are deduplicated by `client_reference`.

Set `maxRetries: 0` if you would rather handle backoff yourself.

## Rate limits and observability

The API allows 600 requests per minute per key by default and sends the state
of your window on every response. The client keeps the last values seen:

```js
await client.catalogue.list();

client.rateLimit;         // { limit: 600, remaining: 597, reset: 42 }
client.lastRequestId;     // "req_01J6ZK3M5X8QW2R7Y9V4B1N0PD"
client.priceListVersion;  // "2026-09-02T04:00:00Z", from X-Price-List-Version
client.lastEtag;          // the ETag from the last order fetched
```

`priceListVersion` is the version to submit with an order for the products you
just priced.

## TypeScript

Types ship with the package as a hand written `index.d.ts`. There is no build
step and no `tsc` in the dependency tree.

```ts
import { SolarJuiceClient, type CatalogueProduct } from '@solarjuice/partner-api';
```

Response types carry an index signature on purpose: the API may add fields
within `/v1`, and reading a new field should not be a type error.

## CommonJS

The package is ES modules only. From CommonJS, load it with a dynamic import,
which needs no bundler and no transpiler:

```js
async function main() {
  const { SolarJuiceClient } = await import('@solarjuice/partner-api');
  const client = new SolarJuiceClient();
  console.log(await client.health());
}
```

## Testing your integration

Pass your own `fetch` to keep tests off the network:

```js
const client = new SolarJuiceClient({
  apiKey: 'sj_test_key',
  fetch: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
});
```

That is how this package tests itself. There is also a `client.request(method,
path, options)` escape hatch that goes through the same auth, retry and error
handling, for endpoints added to `/v1` after this release.

## Development

```sh
npm run lint   # node --check over every source and test file
npm test       # node:test, no network, no dependencies
```

`test/conformance.test.js` reads `spec/openapi.yaml` and fails if the API
grows an operation this client does not implement, or if a method is pointed at
the wrong route.

## Support

Email developers@solarjuice.com.au with the `request_id` of the call in
question, or open an issue on
[GitHub](https://github.com/Solar-Juice/solarjuice-node/issues).

## Licence

MIT. See [LICENSE](LICENSE).
