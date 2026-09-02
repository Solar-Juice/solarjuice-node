/**
 * Freight quotes from the engine that prices the Solar Outlet checkout.
 */
export class ShippingResource {
  #transport;

  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * Price delivery of a cart to an Australian address.
   *
   * Check `quote_status` before reading `rates`: only `priced` can be used on
   * an order, and only until `expires_at`.
   *
   * @param {object} body `{destination, lines, origin_metro?}`.
   * @returns {Promise<object>}
   */
  async quote(body) {
    const { data } = await this.#transport.request('POST', '/v1/shipping/quotes', { body });
    return data;
  }
}
