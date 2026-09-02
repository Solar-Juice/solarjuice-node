// Type definitions for @solarjuice/partner-api
// Project: https://dev.solarjuice.com.au
//
// Hand written from spec/openapi.yaml. Response interfaces carry an index
// signature because the API may add fields within v1 and callers are asked to
// ignore the ones they do not know: an index signature means a new field is
// readable without a type error while the documented fields stay checked.

export declare const VERSION: string;
export declare const DEFAULT_BASE_URL: string;
export declare const DEFAULT_TIMEOUT_SECONDS: number;
export declare const DEFAULT_MAX_RETRIES: number;
export declare const API_KEY_ENV_VAR: string;

/* Primitives. Money and percentages are decimal strings, never floats. */

/** Decimal string with exactly two places, AUD, ex GST unless the field says otherwise. */
export type Money = string;
/** Percentage as a decimal string with two places, for example "15.00". */
export type Percent = string;
/** UTC ISO 8601 with a Z suffix. */
export type Timestamp = string;
/** Opaque price list identifier. Compare for equality, never for ordering. */
export type PriceListVersion = string;
/** Opaque pagination cursor. */
export type Cursor = string;
/** Metro name in title case. The set may grow. */
export type Metro = string;
export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';
/** Open enumeration; new statuses may be added with notice. */
export type OrderStatus =
  | 'received'
  | 'accepted'
  | 'on_hold'
  | 'processing'
  | 'dispatched'
  | 'cancelled'
  | 'rejected'
  | (string & {});
/** Open enumeration; fall back on the HTTP status for unknown codes. */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'PRICE_CHANGED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'QUOTE_UNAVAILABLE'
  | 'STALE_DATA'
  | 'INTERNAL'
  | (string & {});

/* Client */

export interface ClientOptions {
  /** Partner API key. Defaults to the SOLARJUICE_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to https://api.solarjuice.com.au. */
  baseUrl?: string;
  /** Per attempt timeout in seconds. Default 30. */
  timeout?: number;
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Appended to the SDK User-Agent, for example "acme-storefront/2.1". */
  userAgent?: string;
  /** Replacement fetch, for a proxy agent or for tests. */
  fetch?: typeof fetch;
  /** Replacement backoff delay. Intended for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimitSnapshot {
  /** Requests allowed per one minute window for this key. */
  limit: number | null;
  /** Requests remaining in the current window. */
  remaining: number | null;
  /** Seconds until the window resets. */
  reset: number | null;
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

/* Pagination */

export interface PaginationParams {
  /** Page size. Default 100, maximum 500. */
  limit?: number;
  /** Cursor from the previous page's next_cursor. */
  cursor?: Cursor;
  /** Return only items changed at or after this instant. */
  updated_since?: Timestamp;
  [key: string]: unknown;
}

export interface CatalogueListParams extends PaginationParams {
  brand?: string;
  category?: string;
}

export interface SpecialsListParams extends PaginationParams {
  /** Restrict to specials live right now. */
  active?: boolean;
  sku?: string;
}

export interface OrdersListParams extends PaginationParams {
  status?: OrderStatus;
  client_reference?: string;
}

/* Catalogue */

export interface CatalogueProduct {
  sku: string;
  title: string;
  brand: string;
  category: string;
  /** Public list price, ex GST. Never below `price`. */
  list_price: Money;
  /** This channel's price, ex GST. Submit as unit_price on orders. */
  price: Money;
  /** The granted special that produced `price`, or null. */
  special: string | null;
  weight_kg: string;
  images: string[];
  updated_at: Timestamp;
  [key: string]: unknown;
}

export interface CatalogueList {
  as_of: Timestamp;
  price_list_version: PriceListVersion;
  items: CatalogueProduct[];
  next_cursor: Cursor | null;
  [key: string]: unknown;
}

/* Inventory */

/** Sellable quantity keyed by metro. Metros with zero stock are omitted. */
export type AvailableByMetro = Record<Metro, number>;

export interface InventoryItem {
  sku: string;
  available: AvailableByMetro;
  total: number;
  updated_at: Timestamp;
  [key: string]: unknown;
}

export interface InventoryList {
  as_of: Timestamp;
  as_of_oldest: Timestamp;
  /** True when the feed is older than the threshold. Treat figures as indicative. */
  stale: boolean;
  locations: Metro[];
  items: InventoryItem[];
  next_cursor: Cursor | null;
  [key: string]: unknown;
}

export interface InventoryItemDetail extends InventoryItem {
  as_of: Timestamp;
  as_of_oldest: Timestamp;
  stale: boolean;
  locations: Metro[];
}

/* Specials */

export interface Special {
  id: string;
  /** Campaign name. Rows for several SKUs in one campaign share it. */
  name: string;
  sku: string;
  /** Absolute special price, or null for a percentage special. */
  special_price: Money | null;
  /** Percentage off list, or null for an absolute price special. */
  percent_off: Percent | null;
  /** The resulting price for this channel. Always populated. */
  effective_price: Money;
  starts_at: Timestamp;
  ends_at: Timestamp;
  updated_at: Timestamp;
  [key: string]: unknown;
}

export interface SpecialsList {
  as_of: Timestamp;
  items: Special[];
  next_cursor: Cursor | null;
  [key: string]: unknown;
}

/* Shipping */

export interface Destination {
  suburb: string;
  postcode: string;
  state: AustralianState;
  country?: 'AU';
  address_type?: 'residential' | 'business';
}

export interface QuoteLine {
  sku: string;
  quantity: number;
}

export interface ShippingQuoteRequest {
  destination: Destination;
  lines: QuoteLine[];
  /** Force dispatch from this metro instead of the automatically chosen one. */
  origin_metro?: Metro;
}

export interface ShippingRate {
  /** Submit as rate_service_code on the order. */
  service_code: string;
  service_name: string;
  carrier: string;
  /** Freight charge ex GST for the whole consignment. Never "0.00". */
  total_price: Money;
  currency: 'AUD';
  eta_days_min: number;
  eta_days_max: number;
  /** True when the consignment is handled as dangerous goods and the rate includes the surcharge. */
  dangerous_goods: boolean;
  [key: string]: unknown;
}

export interface ShippingQuote {
  quote_id: string;
  /** Only `priced` can be used on an order. */
  quote_status: 'priced' | 'manual_quote_required' | 'unavailable' | (string & {});
  expires_at: Timestamp | null;
  origin_metro: Metro;
  /** Cheapest first. Empty unless quote_status is `priced`. */
  rates: ShippingRate[];
  [key: string]: unknown;
}

/* Orders */

export interface DeliveryAddress {
  name: string;
  company?: string | null;
  phone: string;
  email?: string | null;
  address1: string;
  address2?: string | null;
  suburb: string;
  postcode: string;
  state: AustralianState;
  country?: 'AU';
  instructions?: string | null;
}

export interface OrderLineRequest {
  sku: string;
  quantity: number;
  /** The catalogue `price` for this SKU. Must equal the current channel price. */
  unit_price: Money;
}

export interface OrderRequest {
  /** Your unique reference. This is the key the API deduplicates on. */
  client_reference: string;
  /** The X-Price-List-Version you priced the cart from. */
  price_list_version: PriceListVersion;
  /** A priced, unexpired quote for exactly these lines and this address. */
  quote_id: string;
  /** The service_code of the chosen rate on that quote. */
  rate_service_code: string;
  delivery: DeliveryAddress;
  lines: OrderLineRequest[];
  partner_note?: string | null;
}

export interface OrderLine {
  sku: string;
  title: string;
  quantity: number;
  unit_price: Money;
  line_total: Money;
  special_id: string | null;
  [key: string]: unknown;
}

export interface AppliedSpecial {
  special_id: string;
  sku: string;
  list_price: Money;
  effective_price: Money;
  quantity: number;
  [key: string]: unknown;
}

export interface OrderEvent {
  status: OrderStatus;
  note: string | null;
  actor: 'system' | 'ops' | 'partner' | (string & {});
  created_at: Timestamp;
  [key: string]: unknown;
}

export interface Order {
  id: string;
  channel_id: string;
  client_reference: string;
  status: OrderStatus;
  price_list_version: PriceListVersion;
  currency: 'AUD';
  /** Sum of lines[].line_total, ex GST. */
  subtotal: Money;
  /** Freight for the chosen rate, ex GST. */
  shipping_total: Money;
  /** GST on subtotal plus shipping_total. */
  gst: Money;
  /** Inclusive of GST. */
  total: Money;
  quote_id: string;
  rate_service_code: string;
  delivery: DeliveryAddress;
  lines: OrderLine[];
  applied_specials: AppliedSpecial[];
  partner_note: string | null;
  /** True for orders placed with an sj_test_ key. Never reach operations. */
  sandbox: boolean;
  received_at: Timestamp;
  updated_at: Timestamp;
  /** Status history, oldest first. */
  events: OrderEvent[];
  [key: string]: unknown;
}

export interface OrderReceipt extends Order {
  /** The Idempotency-Key this SDK sent. Log it against your own record. */
  idempotencyKey: string;
}

export interface OrderList {
  as_of: Timestamp;
  items: Order[];
  next_cursor: Cursor | null;
  [key: string]: unknown;
}

export interface Health {
  status: string;
  [key: string]: unknown;
}

/* Resources */

export declare class CatalogueResource {
  list(params?: CatalogueListParams): Promise<CatalogueList>;
  autoPage(params?: Omit<CatalogueListParams, 'cursor'>): AsyncGenerator<CatalogueProduct, void, undefined>;
  get(sku: string): Promise<CatalogueProduct>;
}

export declare class InventoryResource {
  list(params?: PaginationParams): Promise<InventoryList>;
  autoPage(params?: Omit<PaginationParams, 'cursor'>): AsyncGenerator<InventoryItem, void, undefined>;
  get(sku: string): Promise<InventoryItemDetail>;
}

export declare class SpecialsResource {
  list(params?: SpecialsListParams): Promise<SpecialsList>;
  autoPage(params?: Omit<SpecialsListParams, 'cursor'>): AsyncGenerator<Special, void, undefined>;
}

export declare class ShippingResource {
  quote(body: ShippingQuoteRequest): Promise<ShippingQuote>;
}

export interface CreateOrderOptions {
  /** Reuse a key to repeat a submission safely. Generated when omitted. */
  idempotencyKey?: string;
}

export interface GetOrderOptions {
  /** ETag from a previous response. A match resolves to null. */
  ifNoneMatch?: string;
}

export declare class OrdersResource {
  create(body: OrderRequest, options?: CreateOrderOptions): Promise<OrderReceipt>;
  list(params?: OrdersListParams): Promise<OrderList>;
  autoPage(params?: Omit<OrdersListParams, 'cursor'>): AsyncGenerator<Order, void, undefined>;
  /** Resolves to null when an If-None-Match ETag still matches. */
  get(id: string, options?: GetOrderOptions): Promise<Order | null>;
}

export declare class SolarJuiceClient {
  constructor(options?: ClientOptions);

  readonly catalogue: CatalogueResource;
  readonly inventory: InventoryResource;
  readonly specials: SpecialsResource;
  readonly shipping: ShippingResource;
  readonly orders: OrdersResource;

  readonly baseUrl: string;
  readonly userAgent: string;
  /** Rate limit headers from the most recent response. */
  readonly rateLimit: RateLimitSnapshot;
  /** X-Request-Id of the most recent response. */
  readonly lastRequestId: string | null;
  /** The most recent ETag seen, from orders.get. */
  readonly lastEtag: string | null;
  /** The most recent X-Price-List-Version seen on a catalogue response. */
  readonly priceListVersion: string | null;

  health(): Promise<Health>;
  /** Escape hatch for endpoints added to v1 after this release. */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
}

export default SolarJuiceClient;

/* Errors */

export interface ErrorDetail {
  /** JSON path into the request body, or a query or header name. */
  field?: string;
  sku?: string;
  message?: string;
  /** The value you sent (PRICE_CHANGED). */
  submitted?: string;
  /** The value the API currently holds (PRICE_CHANGED, STALE_DATA). */
  current?: string;
  [key: string]: unknown;
}

export interface SolarJuiceErrorOptions {
  code?: string | null;
  details?: ErrorDetail[];
  requestId?: string | null;
  statusCode?: number | null;
  cause?: unknown;
}

export declare class SolarJuiceError extends Error {
  constructor(message: string, options?: SolarJuiceErrorOptions);
  readonly code: ErrorCode | null;
  readonly details: ErrorDetail[];
  /** Quote this in support requests. */
  readonly requestId: string | null;
  /** Null for configuration and transport errors. */
  readonly statusCode: number | null;
}

export declare class ConfigurationError extends SolarJuiceError {}
export declare class TransportError extends SolarJuiceError {}
export declare class TimeoutError extends TransportError {}

export declare class UnauthorizedError extends SolarJuiceError {}
export declare class ForbiddenError extends SolarJuiceError {}
export declare class NotFoundError extends SolarJuiceError {}
export declare class ValidationFailedError extends SolarJuiceError {}
export declare class RateLimitedError extends SolarJuiceError {
  /** Seconds to wait, from Retry-After, when the header was present. */
  readonly retryAfter: number | null;
}
export declare class PriceChangedError extends SolarJuiceError {}
export declare class IdempotencyConflictError extends SolarJuiceError {}
export declare class QuoteUnavailableError extends SolarJuiceError {
  /** Seconds to wait, from Retry-After, when the header was present. */
  readonly retryAfter: number | null;
}
export declare class StaleDataError extends SolarJuiceError {}
export declare class InternalError extends SolarJuiceError {}
