import { SolarJuiceError } from './errors.js';

/**
 * Walk a cursor paginated endpoint and yield each item.
 *
 * The API returns pages of at most 500 items, and a full catalogue or
 * inventory sync is several pages. This turns that into a single `for await`
 * so callers do not hand roll the cursor loop.
 *
 * @template T
 * @param {(cursor: string|undefined) => Promise<{items?: T[], next_cursor?: string|null}>} fetchPage
 * @returns {AsyncGenerator<T, void, undefined>}
 */
export async function* paginate(fetchPage) {
  let cursor;

  for (;;) {
    const page = await fetchPage(cursor);

    for (const item of page?.items ?? []) {
      yield item;
    }

    const next = page?.next_cursor ?? null;

    // Null and an empty string both mean "there is no next page". An empty
    // cursor is not a cursor to send back, and treating it as one turns the
    // last page of a sync into a stall.
    if (next === null || next === '') return;

    // A cursor that does not move would loop forever and quietly burn the
    // caller's rate limit, so fail loudly instead.
    if (next === cursor) {
      throw new SolarJuiceError('Pagination stopped making progress: the API returned the same cursor twice', {
        code: 'PAGINATION_STALLED',
      });
    }

    cursor = next;
  }
}
