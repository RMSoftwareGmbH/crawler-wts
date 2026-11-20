import type { CrawlerLocator } from "../../../crawler-core/src/browser/pageFactory.js";

export const GoogleSelectors = {
  // Google exposes the review's stable key as a data attribute on Maps cards.
  reviewCards: [
    "div.jftiEf[data-review-id]",
    "div.jftiEf[data-reviewid]",
    "article[data-review-id]",
    "article[data-reviewid]",
    "[data-review-card]",
    '[role="listitem"]',
  ],
  reviewsControls: ["button", '[role="button"]', '[role="tab"]'],
  reviewPanels: [
    'div[aria-label*="Reviews"]',
    'div[aria-label*="reviews"]',
    'div[aria-label*="Avis"]',
    'div[aria-label*="avis"]',
    'section[aria-label*="Reviews"]',
    'section[aria-label*="reviews"]',
    'section[aria-label*="Avis"]',
    'section[aria-label*="avis"]',
    '[role="dialog"]',
    '[role="main"]',
    '[role="region"]',
  ],
  reviewPanelScrollRoots: [
    'div[aria-label*="Reviews"]',
    'div[aria-label*="reviews"]',
    'div[aria-label*="Avis"]',
    'div[aria-label*="avis"]',
    'section[aria-label*="Reviews"]',
    'section[aria-label*="reviews"]',
    'section[aria-label*="Avis"]',
    'section[aria-label*="avis"]',
    '[role="dialog"]',
    '[role="main"]',
  ],
  reviewIdAttributes: ["data-review-id", "data-reviewid"],
  ratings: [
    "[data-rating]",
    '[aria-label*="star"]',
    '[aria-label*="étoile"]',
    '[aria-label*="out of 5"]',
    '[role="img"][aria-label]',
    '[class*="fzvQIb"]',
  ],
  ratingTextCandidates: ["span"],
  comments: [
    "[data-review-text]",
    "[data-review-content]",
    '[class*="wiI7pd"]',
  ],
  titles: ["[data-review-title]", "h3"],
  authors: [
    "[data-review-author]",
    "[data-author-name]",
    'button[aria-label^="Photo of"]',
    '[class*="d4r55"]',
  ],
  authorLinks: ['a[href*="/maps/contrib/"]'],
  dates: [
    "[data-review-date]",
    "time",
    '[aria-label*=" ago"]',
    '[class*="xRkPPb"]',
    '[class*="rsqaWe"]',
  ],
  replies: ["[data-business-reply]", "[data-owner-response]"],
  reviewLinks: ['a[href*="review"]', "a[data-review-url]"],
  loadMoreButtons: [
    'button[aria-label*="More reviews"]',
    '[role="button"][aria-label*="More reviews"]',
    "button[data-load-more]",
  ],
} as const;

export function selectorList(selectors: readonly string[]): string {
  return selectors.join(", ");
}

export async function countVisible(locator: CrawlerLocator): Promise<number> {
  let visibleCount = 0;
  for (let index = 0; index < (await locator.count()); index += 1) {
    if (await locator.nth(index).isVisible()) {
      visibleCount += 1;
    }
  }
  return visibleCount;
}
