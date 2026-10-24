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
  createdAt?: string | null;
  updatedAt?: string | null;
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
}
