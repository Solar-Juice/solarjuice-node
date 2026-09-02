import { ConfigurationError } from './errors.js';
import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_SECONDS, Transport } from './http.js';
import { CatalogueResource } from './resources/catalogue.js';
import { InventoryResource } from './resources/inventory.js';
import { OrdersResource } from './resources/orders.js';
import { ShippingResource } from './resources/shipping.js';
import { SpecialsResource } from './resources/specials.js';

const API_KEY_ENV_VAR = 'SOLARJUICE_API_KEY';

/**
 * Client for the Solar Juice Partner API.
 *
 * @example
 * const client = new SolarJuiceClient({ apiKey: process.env.SOLARJUICE_API_KEY });
 * const page = await client.catalogue.list({ limit: 50 });
 */
export class SolarJuiceClient {
  #transport;

  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] Defaults to the SOLARJUICE_API_KEY environment variable.
   * @param {string} [options.baseUrl] Defaults to https://api.solarjuice.com.au.
   * @param {number} [options.timeout] Deadline in seconds for a whole attempt, response body included. Default 30.
   * @param {number} [options.maxRetries] Retries after the first attempt. Default 3.
   * @param {string} [options.userAgent] Suffix appended to the SDK User-Agent, for example "acme-storefront/2.1".
   * @param {typeof fetch} [options.fetch] Replacement fetch, for a proxy agent or for tests.
   * @param {(ms: number) => Promise<void>} [options.sleep] Replacement backoff delay, for tests.
   */
  constructor(options = {}) {
    // Reading the environment here rather than at import time means a process
    // that loads its secrets after startup still works.
    const apiKey = options.apiKey ?? globalThis.process?.env?.[API_KEY_ENV_VAR];

    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new ConfigurationError(
        `A Solar Juice API key is required. Pass {apiKey} or set the ${API_KEY_ENV_VAR} environment variable.`,
      );
    }

    this.#transport = new Transport({ ...options, apiKey: apiKey.trim() });

    /** Products this channel can buy, with the channel's price. */
    this.catalogue = new CatalogueResource(this.#transport);
    /** Sellable quantity per metro. */
    this.inventory = new InventoryResource(this.#transport);
    /** Specials granted to this channel. */
    this.specials = new SpecialsResource(this.#transport);
    /** Freight quotes. */
    this.shipping = new ShippingResource(this.#transport);
    /** Orders placed against this channel's trade account. */
    this.orders = new OrdersResource(this.#transport);
  }

  /** Base URL in use. */
  get baseUrl() {
    return this.#transport.baseUrl;
  }

  /** User-Agent sent with every request. */
  get userAgent() {
    return this.#transport.userAgent;
  }

  /**
   * Rate limit headers from the most recent response. Values are null before
   * the first call.
   *
   * @returns {{limit: number|null, remaining: number|null, reset: number|null}}
   */
  get rateLimit() {
    return this.#transport.rateLimit;
  }

  /**
   * X-Request-Id of the most recent response. Quote it in support requests.
   *
   * @returns {string|null}
   */
  get lastRequestId() {
    return this.#transport.lastRequestId;
  }

  /**
   * The most recent ETag seen, from `orders.get`. Send it back as
   * `ifNoneMatch` when polling.
   *
   * @returns {string|null}
   */
  get lastEtag() {
    return this.#transport.lastEtag;
  }

  /**
   * The most recent X-Price-List-Version seen on a catalogue response. Submit
   * it as `price_list_version` when placing an order.
   *
   * @returns {string|null}
   */
  get priceListVersion() {
    return this.#transport.priceListVersion;
  }

  /**
   * Liveness check. Unauthenticated at the API, though the SDK still sends the
   * key so a single client works everywhere.
   *
   * @returns {Promise<{status: string}>}
   */
  async health() {
    const { data } = await this.#transport.request('GET', '/v1/health');
    return data;
  }

  /**
   * Escape hatch for endpoints added to v1 after this SDK release.
   *
   * Goes through the same auth, retry and error handling as everything else.
   *
   * @param {string} method
   * @param {string} path Path beginning with a slash, for example "/v1/catalogue".
   * @param {object} [options] `{query, body, headers}`.
   * @returns {Promise<unknown>} The decoded response body.
   */
  async request(method, path, options = {}) {
    const { data } = await this.#transport.request(method, path, options);
    return data;
  }
}

export { API_KEY_ENV_VAR, DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_SECONDS };
