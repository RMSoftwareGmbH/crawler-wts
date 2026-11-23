export const ExpediaSelectors = {
  hotelName: ["[data-stid='content-hotel-title']", "h1"],
  reviewCards: [
    "[data-stid='review-card']",
    "[data-stid='guest-review']",
    "[data-review-id]",
    "article[data-stid*='review']",
  ],
  reviewId: ["[data-review-id]", "[data-reviewid]"],
  rating: [
    "[data-stid='review-rating']",
    "[data-stid='review-score']",
    "[data-rating]",
    "[data-score]",
    "[aria-label*='out of 10']",
    "[aria-label*='out of 5']",
  ],
  title: [
    "[data-stid='review-title']",
    "[data-stid='review-headline']",
    "[data-review-title]",
  ],
  comment: [
    "[data-stid='review-text']",
    "[data-stid='review-content']",
    "[data-review-text]",
  ],
  author: [
    "[data-stid='review-author']",
    "[data-stid='reviewer-name']",
    "[data-review-author]",
  ],
  authorProfile: ["a[data-stid='reviewer-profile']", "a[href*='/profile/']"],
  date: [
    "[data-stid='review-date']",
    "[data-stid='review-stay-date']",
    "[data-review-date]",
    "time",
  ],
  language: ["[lang]"],
  businessReply: [
    "[data-stid='management-response']",
    "[data-stid='hotel-response']",
    "[data-business-reply]",
  ],
  nextPage: [
    "[data-stid='reviews-next-page']",
    "[data-stid='pagination-next']",
    "a[rel='next']",
    "button[aria-label='Next page']",
    "a[aria-label='Next page']",
    "button[aria-label='Next']",
    "a[aria-label='Next']",
  ],
} as const;

export function expediaSelectorList(selectors: readonly string[]): string {
  return selectors.join(", ");
}
