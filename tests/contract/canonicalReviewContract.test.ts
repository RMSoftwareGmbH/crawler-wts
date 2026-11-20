import { describe, expect, it } from 'vitest';
import { canonicalReviewSchema } from '../../packages/crawler-contracts/src/index.js';

const review = {
  source: 'google',
  externalReviewId: 'stable-review-id',
  hotel: { name: 'Example Hotel', url: 'https://www.google.com/maps/place/example' },
  rating: { value: 4, scale: 5 },
  comment: 'A public review.',
  sourceMetadata: {
    sourceUrl: 'https://www.google.com/maps/place/example',
    fetchedAt: '2025-05-01T12:00:00.000Z',
    crawlerVersion: '1.0.0',
    schemaVersion: '1.0.0'
  }
};

describe('canonical review contract', () => {
  it('accepts a valid canonical review', () => {
    expect(canonicalReviewSchema.parse(review)).toEqual(review);
  });

  it('rejects an invalid rating and missing stable identifier', () => {
    expect(() =>
      canonicalReviewSchema.parse({
        ...review,
        externalReviewId: '',
        rating: { value: 6, scale: 5 }
      })
    ).toThrow();
  });
});
