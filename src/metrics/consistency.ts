/**
 * Population coefficient of variation on tenant-timezone day intervals.
 * Score is `100 × (1 − sd / mean)`, clamped to 0–100, and is not rounded
 * before the label cut. Fewer than two positive intervals is not a score.
 */
export function purchaseConsistencyLabel(intervals: readonly number[]): string {
  const clean = intervals.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length < 2) return "Insufficient Data";
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  if (!Number.isFinite(mean) || mean <= 0) return "Insufficient Data";
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  const score = Math.max(0, Math.min(100, 100 * (1 - Math.sqrt(variance) / mean)));
  if (score >= 85) return "Highly Consistent";
  if (score >= 65) return "Consistent";
  if (score >= 40) return "Variable";
  return "Sporadic";
}
