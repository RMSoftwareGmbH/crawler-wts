import type { ReviewRating } from '../../crawler-contracts/src/review/rating.js';

export function normalizeRating(value: string | null | undefined): ReviewRating | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.replace(',', '.').match(/(?:^|\D)(\d+(?:\.\d+)?)(?:\s*(?:out of|\/)\s*(\d+(?:\.\d+)?))?/i);
  if (!match) {
    return undefined;
  }

  const rating = Number(match[1]);
  const scale = match[2] ? Number(match[2]) : 5;
  if (!Number.isFinite(rating) || !Number.isFinite(scale) || scale <= 0 || rating < 0 || rating > scale) {
    return undefined;
  }

  return { value: rating, scale };
}