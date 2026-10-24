export function recencyBucket(days: number): string {
  if (days <= 30) return "Recent / Active";
  if (days <= 60) return "Cooling";
  if (days <= 90) return "At Risk";
  if (days <= 180) return "Lapsed";
  return "Dormant / Long-Lapsed";
}
