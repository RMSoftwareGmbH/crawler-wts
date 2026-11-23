export interface HolidayCheckRating {
  value: number;
  scale: 5;
}

export function normalizeHolidayCheckRating(
  rawValue: string,
): HolidayCheckRating | undefined {
  const normalizedText = rawValue.replace(/,/g, ".");
  const match = normalizedText.match(
    /(\d+(?:\.\d+)?)(?:\s*(?:von|out of|\/|of)\s*(\d+(?:\.\d+)?))?/i,
  );
  if (!match?.[1]) return undefined;

  const value = Number(match[1]);
  const statedScale = match[2] ? Number(match[2]) : 6;
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(statedScale) ||
    value < 0 ||
    statedScale <= 0 ||
    value > statedScale
  ) {
    return undefined;
  }
  const normalized = (value / statedScale) * 5;
  if (normalized > 5) return undefined;
  return { value: Math.round(normalized * 100) / 100, scale: 5 };
}
