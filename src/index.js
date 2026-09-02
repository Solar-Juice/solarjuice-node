/**
 * Node.js client for the Solar Juice Partner API.
 *
 * @see https://dev.solarjuice.com.au
 */
export {
  API_KEY_ENV_VAR,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_SECONDS,
  SolarJuiceClient,
} from './client.js';

export {
  ConfigurationError,
  ForbiddenError,
  IdempotencyConflictError,
  InternalError,
  NotFoundError,
  PriceChangedError,
  QuoteUnavailableError,
  RateLimitedError,
  SolarJuiceError,
  StaleDataError,
  TimeoutError,
  TransportError,
  UnauthorizedError,
  ValidationFailedError,
} from './errors.js';

export { VERSION } from './version.js';

export { SolarJuiceClient as default } from './client.js';
