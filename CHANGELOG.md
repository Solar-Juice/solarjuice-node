# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package
follows [semantic versioning](https://semver.org/spec/v2.0.0.html). The major
version tracks the API path version: `1.x` speaks `/v1`.

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
