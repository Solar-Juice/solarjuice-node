import { paginate } from '../pagination.js';
import { uuidv4 } from '../uuid.js';

/**
 * Orders placed against this channel's trade account.
 *
 * Acceptance is asynchronous: `create` returns a 202 receipt with status
 * `received`, and the order moves on from there. Poll with `get` and an ETag,
 * or poll them all at once with `list({updated_since})`.
 */
export class OrdersResource {
  #transport;

  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * Place an order.
   *
   * An Idempotency-Key is always sent, generated when the caller does not
   * supply one, so that a retried request (by this SDK or by the caller) can
   * never book a second order. The key used is returned on the order as
   * `idempotencyKey` so it can be logged against the caller's own record.
   *
   * Note that `client_reference` in the body is the reference the API
   * deduplicates on; the header is recorded alongside it.
   *
   * @param {object} body The order request.
   * @param {object} [options]
   * @param {string} [options.idempotencyKey] Reuse a key to repeat a submission safely.
   * @returns {Promise<object>} The order receipt, with `idempotencyKey` added.
   */
  async create(body, options = {}) {
    const idempotencyKey = options.idempotencyKey ?? uuidv4();

    const { data } = await this.#transport.request('POST', '/v1/orders', {
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });

    if (data && typeof data === 'object') {
      // camelCase so it cannot collide with a future snake_case API field.
      data.idempotencyKey = idempotencyKey;
    }
    return data;
  }

  /**
   * @param {object} [params] limit, cursor, updated_since, status, client_reference.
   * @returns {Promise<object>} The `{as_of, items, next_cursor}` envelope.
   */
  async list(params = {}) {
    const { data } = await this.#transport.request('GET', '/v1/orders', { query: params });
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
   * Fetch one order with its full event history.
   *
   * Passing the ETag from a previous fetch turns an unchanged order into a
   * `304`, which this returns as `null` rather than throwing: not modified is
   * a normal polling outcome, not a failure. The ETag itself is on
   * `client.lastEtag` either way. A missing order still raises NotFoundError,
   * so `null` is unambiguous.
   *
   * @param {string} id Order id.
   * @param {object} [options]
   * @param {string} [options.ifNoneMatch] ETag from a previous response.
   * @returns {Promise<object|null>} The order, or null when it has not changed.
   */
  async get(id, options = {}) {
    const { status, data } = await this.#transport.request(
      'GET',
      `/v1/orders/${encodeURIComponent(id)}`,
      { headers: { 'If-None-Match': options.ifNoneMatch } },
    );

    return status === 304 ? null : data;
  }
}
