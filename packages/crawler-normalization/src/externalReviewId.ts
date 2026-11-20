import { createHash } from 'node:crypto';
import { normalizeText } from './normalizeReview.js';

export interface ReviewIdentityFields {
  reviewUrl?: string;
  rating?: string;
  comment?: string;
  author?: string;
  date?: string;
}

export function createFallbackReviewId(
  hotelUrl: string,
  fields: ReviewIdentityFields
): string | undefined {
  if (fields.reviewUrl) {
    try {
      const reviewUrl = new URL(fields.reviewUrl);
      reviewUrl.username = '';
      reviewUrl.password = '';
      reviewUrl.search = '';
      reviewUrl.hash = '';
      return `google-${createHash('sha256').update(reviewUrl.toString()).digest('hex')}`;
    } catch {
      return undefined;
    }
  }

  const parts = [
    normalizeText(fields.rating),
    normalizeText(fields.comment),
    normalizeText(fields.author),
    normalizeText(fields.date)
  ];
  if (parts.every((part) => part === undefined)) {
    return undefined;
  }

  const stableValue = JSON.stringify([hotelUrl, ...parts]);
  return `google-${createHash('sha256').update(stableValue).digest('hex')}`;
}