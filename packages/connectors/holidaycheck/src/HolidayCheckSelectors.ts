export const HolidayCheckSelectors = {
  hotelName: ["[data-testid='hotel-name']", "[itemprop='name']", "h1"],
  reviewCards: [
    "[data-testid='review-card']",
    "[data-testid='review']",
    "[data-review-id]",
    "[itemprop='review']",
    "article[data-testid*='review']",
  ],
  reviewId: ["[data-review-id]", "[data-reviewid]"],
  rating: [
    "[data-testid='review-rating']",
    "[data-testid='rating']",
    "[itemprop='ratingValue']",
    "[data-rating]",
    "[data-score]",
    "[aria-label*='von 6']",
    "[aria-label*='out of 6']",
  ],
  title: [
    "[data-testid='review-title']",
    "[itemprop='name']",
    "[data-review-title]",
  ],
  comment: [
    "[data-testid='review-text']",
    "[itemprop='reviewBody']",
    "[data-review-text]",
  ],
  author: [
    "[data-testid='review-author']",
    "[itemprop='author']",
    "[data-review-author]",
  ],
  authorProfile: ["a[data-testid='reviewer-profile']", "a[href*='/user/']"],
  date: [
    "[data-testid='review-date']",
    "[itemprop='datePublished']",
    "[data-review-date]",
    "time",
  ],
  language: ["[lang]"],
  businessReply: [
    "[data-testid='hotel-response']",
    "[data-testid='management-response']",
    "[data-business-reply]",
  ],
  nextPage: [
    "[data-testid='reviews-next-page']",
    "[data-testid='pagination-next']",
    "a[rel='next']",
    "button[aria-label='Nächste Seite']",
    "a[aria-label='Nächste Seite']",
    "button[aria-label='Next page']",
    "a[aria-label='Next page']",
    "button[aria-label='Weiter']",
    "a[aria-label='Weiter']",
  ],
} as const;

export function holidayCheckSelectorList(selectors: readonly string[]): string {
  return selectors.join(", ");
}
