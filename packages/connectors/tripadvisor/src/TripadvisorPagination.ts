import type { CrawlerPage } from "../../../crawler-core/src/browser/pageFactory.js";
import {
  TripadvisorSelectors as S,
  selectorList,
} from "./TripadvisorSelectors.js";

export interface TripadvisorPaginationOptions {
  maxPages: number;
  maxReviews: number;
  waitMs?: number;
}

export interface TripadvisorPaginationResult {
  pagesVisited: number;
  stoppedBecause: string;
  reviewCount: number;
}

export class TripadvisorPagination {
  async run(
    page: CrawlerPage,
    options: TripadvisorPaginationOptions,
  ): Promise<TripadvisorPaginationResult> {
    let pagesVisited = 1;
    let previousCount = await page.locator(selectorList(S.reviewCards)).count();
    let stoppedBecause = "max_pages";
    while (
      pagesVisited < Math.max(1, options.maxPages) &&
      previousCount < options.maxReviews
    ) {
      const controls = page.locator(selectorList(S.loadMore));
      if (
        (await controls.count()) === 0 ||
        !(await controls.first().isVisible())
      ) {
        stoppedBecause = "no_load_more_control";
        break;
      }
      await controls.first().click({ timeout: 5_000 });
      pagesVisited += 1;
      if (options.waitMs) await page.waitForTimeout(options.waitMs);
      const currentCount = await page
        .locator(selectorList(S.reviewCards))
        .count();
      if (currentCount <= previousCount) {
        stoppedBecause = "no_progress";
        break;
      }
      previousCount = currentCount;
    }
    if (previousCount >= options.maxReviews) stoppedBecause = "max_reviews";
    return { pagesVisited, stoppedBecause, reviewCount: previousCount };
  }
}
