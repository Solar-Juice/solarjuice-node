# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package
follows [semantic versioning](https://semver.org/spec/v2.0.0.html). The major
version tracks the API path version: `1.x` speaks `/v1`.

## [Unreleased]

### Added

- `orders.cancel(id, {note})` for `POST /v1/orders/{id}/cancel`.

### Changed

- `timeout` is now a deadline for the whole exchange, including reading the
  response body. A server that sends headers and then stalls mid body fails at
  the deadline instead of hanging, and the timeout is retried like any other
  transport failure.
- Redirects are never followed. A `3xx` other than `304` raises
  `SolarJuiceError` carrying the status, rather than the client returning the
  redirect target's body as if it were an API response.
- A `2xx` body that is not a JSON object raises, carrying the status and the
  request id, rather than being returned as a string.
- `Retry-After` is honoured up to 60 seconds. Above that the client raises
  immediately with the API's real value on `error.retryAfter` instead of
  sleeping.
- `timeout` must now be greater than zero. Zero was accepted and aborted every
  request the moment it was sent.

### Fixed

- The rate limit window and request id keep their last seen values when a
  response omits those headers, which every `/v1/health` call and every edge
  error page does. They were being cleared on any header-less response.
- `autoPage()` terminates on an empty `next_cursor` instead of raising
  `PAGINATION_STALLED`.
- `require()` of the package works on Node 22.12 and later. The Node 18 crypto
  fallback used a top-level `await`, which made the module graph async and
  raised `ERR_REQUIRE_ASYNC_MODULE`.

## [1.0.0] - 2026-09-02

Initial release, matching version 1.0.0 of the Solar Juice Partner API.

### Added

- `SolarJuiceClient` with the `catalogue`, `inventory`, `specials`, `shipping`
  and `orders` resource groups, plus `health()`.
- `autoPage()` on every list endpoint, walking `next_cursor` and yielding items.
- Automatic `Idempotency-Key` on `orders.create`, exposed on the receipt.
- Conditional fetch of an order with `ifNoneMatch`, resolving to `null` on 304.
- Typed errors, one per documented error code, with `code`, `details`,
  `requestId` and `statusCode`, plus `TransportError` and `TimeoutError`.
- Retries on 429, 502, 503, 504 and network failures, with full jitter
  exponential backoff and `Retry-After` support.
- Rate limit, request id and price list version visibility on the client.
- Hand written TypeScript definitions.

[1.0.0]: https://github.com/Solar-Juice/solarjuice-node/releases/tag/v1.0.0
