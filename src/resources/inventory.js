import { paginate } from '../pagination.js';

/**
 * Sellable quantity per metro, the same figures the Solar Outlet storefront
 * sells from. Stock is not reserved by reading it.
 *
 * Query parameters are passed through untouched rather than allow listed, so
 * a filter the API adds within v1 works without waiting for a release.
 */
export class InventoryResource {
  #transport;

  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * @param {object} [params] limit, cursor, updated_since, state.
   *   `state` scopes the whole answer to one state: `available` is keyed by
   *   it and `total` is that state's stock. `QLD` is Brisbane plus
   *   Townsville.
   * @returns {Promise<object>} The `{as_of, as_of_oldest, stale, locations, items, next_cursor}` envelope.
   */
  async list(params = {}) {
    const { data } = await this.#transport.request('GET', '/v1/inventory', { query: params });
    return data;
  }

  /**
   * @param {object} [params] As `list`, minus `cursor`, which is managed here.
   * @returns {AsyncGenerator<object, void, undefined>}
   */
  autoPage(params = {}) {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /**
   * @param {string} sku Solar Juice part number, case sensitive.
   * @param {object} [params] `state`, scoping the answer as it does on `list`.
   * @returns {Promise<object>}
   */
  async get(sku, params = {}) {
    const { data } = await this.#transport.request(
      'GET',
      `/v1/inventory/${encodeURIComponent(sku)}`,
      { query: params },
    );
    return data;
  }
}
