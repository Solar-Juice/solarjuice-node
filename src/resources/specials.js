import { paginate } from '../pagination.js';

/**
 * Time boxed prices granted to this channel.
 *
 * Granted specials are already folded into the catalogue price, so this is for
 * display and for knowing when a price is about to change.
 */
export class SpecialsResource {
  #transport;

  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * @param {object} [params] limit, cursor, updated_since, active, sku.
   * @returns {Promise<object>} The `{as_of, items, next_cursor}` envelope.
   */
  async list(params = {}) {
    const { data } = await this.#transport.request('GET', '/v1/specials', { query: params });
    return data;
  }

  /**
   * @param {object} [params] As `list`, minus `cursor`, which is managed here.
   * @returns {AsyncGenerator<object, void, undefined>}
   */
  autoPage(params = {}) {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }
}
