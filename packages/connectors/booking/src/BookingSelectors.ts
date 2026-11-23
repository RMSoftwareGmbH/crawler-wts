export const BookingSelectors = {
  hotelName: ["h1[data-testid='title']", "h1"],
  reviewCards: [
    "[data-testid='review-card']",
    "[data-review-id]",
    "article[data-testid*='review']",
  ],
  reviewId: ["[data-review-id]", "[data-reviewid]"],
  rating: [
    "[data-testid='review-score']",
    "[data-score]",
    "[data-rating]",
    "[aria-label*='out of 10']",
    "[aria-label*='out of 5']",
  ],
  title: [
    "[data-testid='review-title']",
    "[data-testid='review-title-text']",
    "[data-review-title]",
  ],
  comment: [
    "[data-testid='review-text']",
    "[data-testid='review-content']",
    "[data-review-text]",
  ],
  author: [
    "[data-testid='reviewer-name']",
    "[data-testid='review-author']",
    "[data-review-author]",
  ],
  authorProfile: ["a[data-testid='reviewer-profile']", "a[href*='/profile/']"],
  date: [
    "[data-testid='review-date]",
    "[data-testid='review-stay-date']",
    "[data-review-date]",
    "time",
  ],
  language: ["[lang]"],
  businessReply: [
    "[data-testid='review-response']",
    "[data-testid='hotel-response']",
    "[data-business-reply]",
  ],
  noReviews: [
    "[data-testid='no-reviews']",
    "[data-testid='review-empty-state']",
  ],
  nextPage: [
    "[data-testid='load-more-reviews-button']",
    "[data-testid='pagination-next-button']",
    "a[rel='next']",
    "button[aria-label='Next page']",
    "a[aria-label='Next page']",
    "button[aria-label='Next']",
    "a[aria-label='Next']",
  ],
} as const;

export function bookingSelectorList(selectors: readonly string[]): string {
  return selectors.join(", ");
}
