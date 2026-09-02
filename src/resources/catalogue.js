import { paginate } from '../pagination.js';

/**
 * Products this channel can buy, with the channel's own price.
 *
 * Query parameters are passed through untouched rather than allow listed: the
 * API adds filters within v1, and a pass through means a new filter works
 * without waiting for an SDK release.
 */
export class CatalogueResource {
  #transport;

  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * @param {object} [params] limit, cursor, updated_since, brand, category.
   * @returns {Promise<object>} The `{as_of, price_list_version, items, next_cursor}` envelope.
   */
  async list(params = {}) {
    const { data } = await this.#transport.request('GET', '/v1/catalogue', { query: params });
    return data;
  }

  /**
   * Every product across every page, one at a time.
   *
   * @param {object} [params] As `list`, minus `cursor`, which is managed here.
   * @returns {AsyncGenerator<object, void, undefined>}
   */
  autoPage(params = {}) {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /**
   * @param {string} sku Solar Juice part number, case sensitive.
   * @returns {Promise<object>}
   */
  async get(sku) {
    const { data } = await this.#transport.request(
      'GET',
      `/v1/catalogue/${encodeURIComponent(sku)}`,
    );
    return data;
  }
}
