import { CrawlError } from "../../../crawler-core/src/crawler/CrawlError.js";
import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";
import type { GoogleDetection } from "./GoogleDetection.js";
import { isFullReviewsLabel } from "./GoogleLabels.js";
import { GoogleSelectors, selectorList } from "./GoogleSelectors.js";

export interface GooglePaginationOptions {
  maxPages: number;
  maxReviews: number;
  delayMs: number;
  timeoutMs: number;
  persistedReviewIds?: readonly string[];
  lastSeenReviewId?: string;
  collectExternalReviewIds: () => Promise<readonly string[]>;
}

export interface GooglePaginationResult {
  pagesVisited: number;
  stoppedBecause:
    | "max_reviews_reached"
    | "no_load_more_button"
    | "no_new_cards"
    | "max_pages_reached"
    | "protection_page"
    | "last_seen_review_id_reached";
}

function isMoreReviewsLabel(value: string): boolean {
  return isFullReviewsLabel(value);
}

export class GooglePagination {
  async run(
    page: CrawlerPage,
    options: GooglePaginationOptions,
    detect: GoogleDetection,
    requestedUrl: string,
  ): Promise<GooglePaginationResult> {
    let pagesVisited = 1;
    let stoppedBecause: GooglePaginationResult["stoppedBecause"] =
      "max_pages_reached";
    const persistedReviewIds = new Set(options.persistedReviewIds ?? []);
    const seenReviewIds = new Set(await options.collectExternalReviewIds());
    const newReviewIds = new Set(
      [...seenReviewIds].filter((reviewId) => !persistedReviewIds.has(reviewId)),
    );
    if (
      options.lastSeenReviewId &&
      seenReviewIds.has(options.lastSeenReviewId)
    ) {
      return { pagesVisited, stoppedBecause: "last_seen_review_id_reached" };
    }

    for (let pageNumber = 1; pageNumber < options.maxPages; pageNumber += 1) {
      if (newReviewIds.size >= options.maxReviews) {
        stoppedBecause = "max_reviews_reached";
        break;
      }

      await this.assertPageIsValid(page, detect, requestedUrl);
      const more = page.locator(
        'button, [role="button"], ' +
          selectorList(GoogleSelectors.loadMoreButtons),
      );
      let button;
      for (let index = 0; index < (await more.count()); index += 1) {
        const candidate = more.nth(index);
        if (
          (await candidate.isVisible()) &&
          (await this.labels(candidate)).some(isMoreReviewsLabel)
        ) {
          button = candidate;
          break;
        }
      }
      if (!button) {
        stoppedBecause = "no_load_more_button";
        break;
      }

      try {
        await button.click({ timeout: options.timeoutMs });
        await page.waitForTimeout(options.delayMs);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google load-more interaction failed.";
        throw new CrawlError("pagination_failure", message);
      }

      await this.assertPageIsValid(page, detect, requestedUrl);
      pagesVisited += 1;
      const currentReviewIds = await options.collectExternalReviewIds();
      let addedReviewCount = 0;
      for (const reviewId of currentReviewIds) {
        if (reviewId === options.lastSeenReviewId) {
          stoppedBecause = "last_seen_review_id_reached";
          break;
        }
        if (seenReviewIds.has(reviewId)) {
          continue;
        }
        seenReviewIds.add(reviewId);
        if (!persistedReviewIds.has(reviewId)) {
          newReviewIds.add(reviewId);
          addedReviewCount += 1;
        }
      }
      if (stoppedBecause === "last_seen_review_id_reached") {
        break;
      }
      if (addedReviewCount === 0) {
        stoppedBecause = "no_new_cards";
        break;
      }
    }

    return { pagesVisited, stoppedBecause };
  }

  private async labels(locator: CrawlerLocator): Promise<string[]> {
    const [text, ariaLabel, title] = await Promise.all([
      locator.innerText(),
      locator.getAttribute("aria-label"),
      locator.getAttribute("title"),
    ]);
    return [text, ariaLabel ?? "", title ?? ""];
  }

  private async assertPageIsValid(
    page: CrawlerPage,
    detection: GoogleDetection,
    requestedUrl: string,
  ): Promise<void> {
    const result = await detection.classify(page, requestedUrl);
    if (result.status !== "valid") {
      throw new CrawlError(
        result.status,
        result.reason ?? "Google page is not available for crawling.",
      );
    }
  }
}
