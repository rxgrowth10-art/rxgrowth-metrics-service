import type { CustomerStatus, CustomerType } from "./types.js";

export function lifecycleStage(qualifyingOrderCount: number, recencyDays: number | null): string {
  if (qualifyingOrderCount === 0) return "NO QUALIFYING ORDERS";
  if (qualifyingOrderCount === 1) return "NEW";
  if (recencyDays === null) return "LOST";
  if (recencyDays <= 30) return "ACTIVE";
  if (recencyDays <= 60) return "ACTIVE-COOLING";
  if (recencyDays <= 90) return "AT RISK";
  if (recencyDays <= 180) return "LAPSED";
  return "LOST";
}

export function customerType(qualifyingOrderCount: number): CustomerType {
  return qualifyingOrderCount === 0 ? "Lead" : "Customer";
}

export function customerStatus(qualifyingOrderCount: number, recencyDays: number | null): CustomerStatus {
  if (qualifyingOrderCount <= 1) return "New";
  if (recencyDays === null) return "Lost";
  if (recencyDays <= 60) return "Active";
  if (recencyDays <= 90) return "At Risk";
  if (recencyDays <= 180) return "Lapsed";
  return "Lost";
}
