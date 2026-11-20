export function deduplicateReviews<T extends { externalReviewId: string }>(
  reviews: readonly T[]
): { reviews: T[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const review of reviews) {
    if (seen.has(review.externalReviewId)) {
      continue;
    }
    seen.add(review.externalReviewId);
    unique.push(review);
  }

  return { reviews: unique, duplicatesRemoved: reviews.length - unique.length };
}