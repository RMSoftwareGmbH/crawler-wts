export function normalizeDate(
  value: string | null | undefined,
  referenceDate: Date
): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const text = value.trim();
  const relative = text.match(/(\d+|a|an)\s+(day|week|month|year)s?\s+ago/i);
  if (relative) {
    const amount = relative[1] === 'a' || relative[1] === 'an' ? 1 : Number(relative[1]);
    const date = new Date(referenceDate);
    const unit = relative[2]?.toLowerCase();
    if (unit === 'day') {
      date.setUTCDate(date.getUTCDate() - amount);
    } else if (unit === 'week') {
      date.setUTCDate(date.getUTCDate() - amount * 7);
    } else if (unit === 'month') {
      date.setUTCMonth(date.getUTCMonth() - amount);
    } else if (unit === 'year') {
      date.setUTCFullYear(date.getUTCFullYear() - amount);
    }
    return date.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}