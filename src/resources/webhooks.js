/**
 * Webhook endpoints registered by this channel.
 *
 * Any key for the channel can manage them; no extra scope is needed. A
 * delivery is a notification, not the data: on receipt, re-fetch the affected
 * resource rather than trusting the payload.
 */
export class WebhooksResource {
  #transport;

  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * Every endpoint this channel has registered, disabled ones included, with
   * delivery health. The list is not paginated.
   *
   * @returns {Promise<object>} The `{endpoints}` envelope.
   */
  async list() {
    const { data } = await this.#transport.request('GET', '/v1/webhooks');
    return data;
  }

  /**
   * Register an HTTPS endpoint.
   *
   * The response carries `secret`, the HMAC signing secret. It is returned
   * here once and never again, so store it before doing anything else. To
   * rotate it, delete the endpoint and register a fresh one.
   *
   * @param {object} body `{url, events, description}`.
   * @returns {Promise<object>} The endpoint, with `secret`.
   */
  async create(body) {
    const { data } = await this.#transport.request('POST', '/v1/webhooks', { body });
    return data;
  }

  /**
   * Remove an endpoint and invalidate its secret.
   *
   * @param {string} id Webhook endpoint id.
   * @returns {Promise<void>} The API answers 204 with no body.
   */
  async delete(id) {
    await this.#transport.request('DELETE', `/v1/webhooks/${encodeURIComponent(id)}`);
  }

  /**
   * Switch a disabled endpoint back to active and clear its failure count.
   *
   * The endpoint keeps its id and its signing secret, which is why this beats
   * deleting and re-registering: nothing has to be redeployed on the
   * receiving side. Harmless on an endpoint that is already active.
   *
   * @param {string} id Webhook endpoint id.
   * @returns {Promise<object>} The endpoint, now active.
   */
  async enable(id) {
    const { data } = await this.#transport.request(
      'POST',
      `/v1/webhooks/${encodeURIComponent(id)}/enable`,
    );
    return data;
  }

  /**
   * Queue one `webhook.test` delivery to prove the receiver and its signature
   * check work. It travels the same signing and retry path as a real event.
   *
   * A disabled endpoint is refused with ValidationFailedError rather than
   * queued, because it would never be delivered: call `enable` first.
   *
   * @param {string} id Webhook endpoint id.
   * @returns {Promise<object>} `{queued, event, note}`.
   */
  async test(id) {
    const { data } = await this.#transport.request(
      'POST',
      `/v1/webhooks/${encodeURIComponent(id)}/test`,
    );
    return data;
  }
}
