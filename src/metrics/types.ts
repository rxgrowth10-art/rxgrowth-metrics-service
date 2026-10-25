/** One line from an order detail. No customer fields. */
export interface OrderLine {
  productId: string | null;
  name: string | null;
  qty: number | null;
  /** `price.amount × qty`. Null when either side is missing. */
  spend: number | null;
  collectionIds: readonly string[];
}

/**
 * Compact order-detail summary stored in Upstash. The allowlist is the whole
 * value: contact id, contactSnapshot, and any other customer field stay out.
 */
export interface OrderDetailSummary {
  orderId: string;
  updatedAt: string | null;
  items: readonly OrderLine[];
  deliveryMethod: string | null;
  sourceType: string | null;
  sourceSubType: string | null;
  sourceName: string | null;
  couponCode: string | null;
  branchName: string | null;
}

export interface MetricOrder {
  id?: string | null;
  contactId?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  liveMode?: boolean | null;
  markAsTest?: boolean | null;
  amount?: number | string | null;
  sourceName?: string | null;
  sourceSubType?: string | null;
  sourceType?: string | null;
  deliveryMethod?: string | null;
  branchName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  items?: readonly OrderLine[];
  couponCode?: string | null;
  /** Present after the summary cache resolves. Metrics do not read it. */
  detailSummary?: OrderDetailSummary | null;
}

export type Trend = "Increasing" | "Decreasing" | "Stable" | "Insufficient Data";

export type CustomerType = "Lead" | "Customer";

export type CustomerStatus = "New" | "Active" | "At Risk" | "Lapsed" | "Lost";

export interface CustomerMetrics {
  qualifyingOrderCount: number;
  totalOrders: number;
  excludedOrderCount: number;
  lifetimeValue: number;
  averageOrderValue: number;
  highestOrderValue: number | null;
  lowestOrderValue: number | null;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  lastOrderType: string | null;
  lastOrderLocation: string | null;
  recencyDays: number | null;
  recencyBucket: string | null;
  trailing12MonthOrderCount: number;
  frequencyBucket: string;
  ordersLast30Days: number;
  ordersPrevious30Days: number;
  spendLast30Days: number;
  spendPrevious30Days: number;
  orderFrequencyTrend: Trend;
  spendingTrend: Trend;
  orderIntervalsDays: number[];
  averageOrderIntervalDays: number | null;
  typicalOrderIntervalDays: number | null;
  daysSinceLastOrder: number | null;
  expectedNextOrderDate: string | null;
  daysOverdue: number | null;
  overdueRatio: number | null;
  lifecycleStage: string;
  customerType: CustomerType;
  customerStatus: CustomerStatus;
  favoriteItem: string | null;
  /** Up to five product names, separated by ", ". */
  topItems: string | null;
  /** Raw checkout method (`shipping` or `pickup`) of the preferred type. */
  preferredOrderType: string | null;
  preferredLocation: string | null;
  purchaseConsistency: string;
  orderSourceMix: string | null;
  /** Mapped picklist label. Null when no qualifying order was classified. */
  primaryOrderSource: string | null;
}
