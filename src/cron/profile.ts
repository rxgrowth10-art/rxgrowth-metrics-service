import type { CustomFieldWrite, GhlContact } from "../ghl/index.js";
import { behaviorProfile } from "../metrics/behavior.js";
import { intelligenceSummary } from "../metrics/summary.js";
import { M06_VALUE_FIELD_KEYS } from "../metrics/value.js";
import { readContactField, requireFieldId } from "../writeback/fields.js";
import { M06_DETAIL_FIELD_KEYS } from "../writeback/m06.js";

const GATED_KEYS = new Set<string>([...M06_DETAIL_FIELD_KEYS, ...M06_VALUE_FIELD_KEYS]);

const BEHAVIOR_KEY = "customer_behavior_profile";
const SUMMARY_KEY = "customer_intelligence_summary";

export interface NightlyProfile {
  /** null leaves the behaviour key off the update. */
  behavior: string | null;
  summary: string;
}

/**
 * Behaviour and the intelligence summary from fields already stored on the
 * contact. A fresh M06 payload from tonight's reconcile wins. A gated key
 * missing from that payload is not read off the older contact, so the
 * behaviour label stays off the update and out of metrics_hash.
 */
export function nightlyProfile(args: {
  contact: GhlContact;
  ids: ReadonlyMap<string, string>;
  restaurantName: string;
  currency: string;
  fresh?: Record<string, string> | undefined;
}): NightlyProfile {
  const view = applyFresh(args.contact, args.fresh, args.ids);
  const qualifying = fieldState(view, "qualifying_order_count", args.ids);
  const status = fieldState(view, "customer_status", args.ids);
  const vip = fieldState(view, "vip_status", args.ids);
  const consistency = fieldState(view, "purchase_consistency", args.ids);
  const recent = fieldState(view, "orders_last_30_days", args.ids);
  const diversity = fieldState(view, "category_diversity", args.ids);
  const behavior = behaviorProfile({
    qualifyingOrderCount: count(qualifying),
    customerStatus: text(status),
    vipStatus: vipLabel(vip),
    purchaseConsistency: text(consistency),
    ordersLast30Days: count(recent),
    categoryDiversity: diversityCount(diversity),
  });
  const summary = intelligenceSummary({
    restaurantName: args.restaurantName,
    currency: args.currency,
    customerStatus: text(status),
    lifecycleStage: text(fieldState(view, "lifecycle_stage", args.ids)),
    behaviorProfile: behavior || null,
    purchaseConsistency: text(consistency),
    qualifyingOrderCount: text(qualifying),
    ordersLast30Days: text(recent),
    ordersPrevious30Days: text(fieldState(view, "orders_previous_30_days", args.ids)),
    firstOrderDate: text(fieldState(view, "first_order_date", args.ids)),
    lastOrderDate: text(fieldState(view, "last_order_date", args.ids)),
    daysSinceLastOrder: text(fieldState(view, "days_since_last_order", args.ids)),
    averageOrderIntervalDays: text(fieldState(view, "average_order_interval_days", args.ids)),
    typicalOrderIntervalDays: text(fieldState(view, "typical_order_interval_days", args.ids)),
    lifetimeValue: text(fieldState(view, "lifetime_value", args.ids)),
    averageOrderValue: text(fieldState(view, "average_order_value", args.ids)),
    highestOrderValue: text(fieldState(view, "highest_order_value", args.ids)),
    lowestOrderValue: text(fieldState(view, "lowest_order_value", args.ids)),
    customerValueScore: text(fieldState(view, "customer_value_score", args.ids)),
    lifetimeSpendPercentile: text(fieldState(view, "lifetime_spend_percentile", args.ids)),
    orderFrequencyPercentile: text(fieldState(view, "order_frequency_percentile", args.ids)),
    vipStatus: vipLabel(vip),
    vipClassification: text(fieldState(view, "vip_classification", args.ids)),
    favoriteItem: text(fieldState(view, "favorite_item", args.ids)),
    topItems: text(fieldState(view, "top_items", args.ids)),
    favoriteCategory: text(fieldState(view, "favorite_category", args.ids)),
    topCategories: text(fieldState(view, "top_categories", args.ids)),
    categoryDiversity: text(diversity),
    preferredOrderType: text(fieldState(view, "preferred_order_type", args.ids)),
    preferredLocation: text(fieldState(view, "preferred_location", args.ids)),
    primaryOrderSource: text(fieldState(view, "primary_order_source", args.ids)),
    orderSourceMix: text(fieldState(view, "order_source_mix", args.ids)),
    orderFrequencyTrend: text(fieldState(view, "order_frequency_trend", args.ids)),
    spendingTrend: text(fieldState(view, "spending_trend", args.ids)),
  });
  return { behavior, summary };
}

/** Changed behaviour and summary fields only. An omitted behaviour label is not included. */
export function profileFieldWrites(
  contact: GhlContact,
  ids: ReadonlyMap<string, string>,
  profile: NightlyProfile,
): CustomFieldWrite[] {
  const fields: CustomFieldWrite[] = [];
  if (profile.behavior !== null) {
    const current = readContactField(contact, BEHAVIOR_KEY, ids) ?? "";
    if (profile.behavior !== current) {
      fields.push({
        id: requireFieldId(ids, BEHAVIOR_KEY),
        key: BEHAVIOR_KEY,
        value: profile.behavior,
      });
    }
  }
  const currentSummary = readContactField(contact, SUMMARY_KEY, ids) ?? "";
  if (profile.summary !== currentSummary) {
    fields.push({
      id: requireFieldId(ids, SUMMARY_KEY),
      key: SUMMARY_KEY,
      value: profile.summary,
    });
  }
  return fields;
}

function applyFresh(
  contact: GhlContact,
  fresh: Record<string, string> | undefined,
  ids: ReadonlyMap<string, string>,
): GhlContact {
  if (!fresh) return contact;
  let customFields = contact.customFields.map((field) => ({ ...field }));
  for (const key of GATED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fresh, key)) continue;
    customFields = customFields.filter((field) => !matches(field, key, ids));
  }
  for (const [key, value] of Object.entries(fresh)) {
    const id = ids.get(key) ?? null;
    const existing = customFields.find((field) => matches(field, key, ids));
    if (existing) {
      existing.value = value;
      if (!existing.id && id) existing.id = id;
      if (!existing.key) existing.key = key;
    } else {
      customFields.push({ id, key, value });
    }
  }
  return { id: contact.id, customFields };
}

function matches(field: GhlContact["customFields"][number], key: string, ids: ReadonlyMap<string, string>): boolean {
  const id = ids.get(key) ?? null;
  const fieldKey = field.key?.replace(/^contact\./, "");
  return (id !== null && field.id === id) || fieldKey === key;
}

function fieldState(
  contact: GhlContact,
  key: string,
  ids: ReadonlyMap<string, string>,
): { available: boolean; value: string } {
  const id = ids.get(key) ?? null;
  for (const field of contact.customFields) {
    const fieldKey = field.key?.replace(/^contact\./, "");
    if ((id !== null && field.id === id) || fieldKey === key) {
      return { available: true, value: field.value?.trim() ?? "" };
    }
  }
  return { available: false, value: "" };
}

function text(state: { available: boolean; value: string }): string | null {
  if (!state.available || state.value === "") return null;
  return state.value;
}

function count(state: { available: boolean; value: string }): number | null {
  if (!state.available || state.value === "") return null;
  const value = Number(state.value);
  return Number.isFinite(value) ? value : null;
}

function diversityCount(state: { available: boolean; value: string }): number | null | undefined {
  if (!state.available) return undefined;
  if (state.value === "") return null;
  const value = Number(state.value);
  return Number.isFinite(value) ? value : undefined;
}

function vipLabel(state: { available: boolean; value: string }): string | null {
  if (state.value === "VIP" || state.value === "Not VIP") return state.value;
  return null;
}
