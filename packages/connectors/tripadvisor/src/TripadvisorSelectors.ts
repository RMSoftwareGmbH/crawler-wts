export const TripadvisorSelectors = {
  reviewCards: [
    '[data-automation="reviewCard"]',
    "[data-review-id]",
    "article[data-review-id]",
  ],
  reviewId: ["[data-review-id]", "[data-reviewid]"],
  rating: [
    '[data-automation="bubbleRatingImage"]',
    "[data-rating]",
    '[aria-label*="out of 5"]',
    '[aria-label*="bubble rating"]',
  ],
  title: ['[data-automation="reviewTitle"]', "[data-review-title]"],
  comment: ['[data-automation="reviewText"]', "[data-review-text]"],
  author: ['[data-automation="reviewerName"]', "[data-review-author]"],
  authorProfile: ['a[href*="/Profile/"]', "a[data-reviewer-profile]"],
  date: ['[data-automation="reviewDate"]', "[data-review-date]", "time"],
  language: ["[lang]"],
  businessReply: ['[data-automation="ownerResponse"]', "[data-business-reply]"],
  loadMore: [
    '[data-automation="loadMoreReviews"]',
    "[data-load-more-reviews]",
    "[data-load-more]",
  ],
} as const;

export function selectorList(selectors: readonly string[]): string {
  return selectors.join(", ");
}
