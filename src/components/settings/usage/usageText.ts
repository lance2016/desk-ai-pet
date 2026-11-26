/** Monday first, as `UsageDay.weekday` counts. */
export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
export const WEEKEND = new Set([5, 6]);

/** "2026-11-26" as "11月26日". */
export const dayText = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
/** "2026-11-26" as "11/26". */
export const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** The top of a scale above `most`: 1, 2 or 5 times a power of ten, so the grid lines land on round numbers. */
export function niceMax(most: number): number {
  if (most <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(most));
  return ([1, 2, 5, 10].map((step) => step * power).find((top) => top >= most) ?? 10 * power);
}

/** "+2 天", "-1 天", "持平". */
export function dayChange(count: number, previous: number): string {
  const difference = count - previous;
  return difference === 0 ? "持平" : `${difference > 0 ? "+" : "-"}${Math.abs(difference)} 天`;
}
