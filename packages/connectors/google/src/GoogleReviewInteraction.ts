import { CrawlError } from "../../../crawler-core/src/crawler/CrawlError.js";
import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";
import {
  countVisible,
  GoogleSelectors,
  selectorList,
} from "./GoogleSelectors.js";

export interface GoogleReviewInteractionResult {
  reviewsControlFound: boolean;
  reviewsControlClicked: boolean;
  reviewsControlSearchStartedAt: string;
  reviewsControlSearchFinishedAt: string;
  reviewsPanelFound: boolean;
  reviewCardCountBeforeClick: number;
  reviewCardCountAfterClick: number;
  reviewPanelOpeningMs: number;
  reviewCardCountBeforeScroll: number;
  reviewCardCountAfterEachScroll: number[];
  scrollAttempts: number;
  newReviewsPerScroll: number[];
  totalUniqueCardsSeen: number;
  stoppedBecause: GoogleInteractionStopReason;
  scrollingMs: number;
}

export interface GoogleMapsReadinessResult {
  mapsContentReady: boolean;
  reviewsControlSearchStartedAt: string;
  reviewsControlSearchFinishedAt: string;
}

export type GoogleInteractionStopReason =
  | "max_reviews_reached"
  | "no_new_cards"
  | "no_scrollable_container"
  | "review_panel_unavailable"
  | "max_scroll_attempts"
  | "last_seen_review_id_reached";

export interface GoogleReviewInteractionOptions {
  timeoutMs: number;
  maxReviews: number;
  panelWaitMs: number;
  interactionWaitMs: number;
  reviewsControlSearchStartedAt?: string;
  persistedReviewIds?: readonly string[];
  lastSeenReviewId?: string;
  collectExternalReviewIds: () => Promise<readonly string[]>;
  onProgress?: (progress: Partial<GoogleReviewInteractionResult>) => void;
}

const MAX_SCROLL_ATTEMPTS = 50;

function isReviewsLabel(value: string): boolean {
  return /^(?:reviews?|avis|التقييمات|المراجعات|مراجعات|تقييمات)(?:\b|\s|\(|$)/i.test(
    value.trim(),
  );
}

function isReviewExpansionLabel(value: string): boolean {
  return /^(?:more|plus)$/i.test(value.trim());
}

async function visibleReviewCardCount(page: CrawlerPage): Promise<number> {
  return countVisible(page.locator(selectorList(GoogleSelectors.reviewCards)));
}

function isHotelHeading(value: string): boolean {
  return Boolean(
    value.trim() &&
      !/^(?:google maps|maps|google|خرائط google|خرائط جوجل|خرائط غوغل)$/i.test(
        value.trim(),
      ),
  );
}

function isProtectionPageText(value: string): boolean {
  return /captcha|unusual traffic|automated quer|verify you are human|robot check|access denied|request blocked|before you continue to google|consent required|sign in to continue|authentication required/i.test(
    value,
  );
}

function hasPlaceContentSignal(value: string): boolean {
  return (
    /\b(?:no reviews|\d[\d,.]*\s+reviews?)\b/i.test(value) ||
    /(?:لا توجد مراجعات|لا توجد تقييمات|\d[\d,.]*\s*(?:مراجعة|تقييم))/i.test(
      value,
    )
  );
}

async function labels(locator: CrawlerLocator): Promise<string[]> {
  const [text, ariaLabel, title, dataValue, dataTab] = await Promise.all([
    locator.innerText(),
    locator.getAttribute("aria-label"),
    locator.getAttribute("title"),
    locator.getAttribute("data-value"),
    locator.getAttribute("data-tab"),
  ]);
  return [text, ariaLabel ?? "", title ?? "", dataValue ?? "", dataTab ?? ""];
}

async function findReviewsControl(
  page: CrawlerPage,
): Promise<CrawlerLocator | undefined> {
  const controls = page.locator(selectorList(GoogleSelectors.reviewsControls));
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (
      (await control.isVisible()) &&
      (await labels(control)).some(isReviewsLabel)
    ) {
      return control;
    }
  }
  return undefined;
}

async function waitForReviewsControl(
  page: CrawlerPage,
  waitMs: number,
): Promise<CrawlerLocator | undefined> {
  let waitedMs = 0;
  while (waitedMs < waitMs) {
    const control = await findReviewsControl(page);
    if (control) {
      return control;
    }
    const intervalMs = Math.min(150, waitMs - waitedMs);
    await page.waitForTimeout(intervalMs);
    waitedMs += intervalMs;
  }
  return findReviewsControl(page);
}

async function hasReviewsPanel(page: CrawlerPage): Promise<boolean> {
  if ((await visibleReviewCardCount(page)) > 0) {
    return true;
  }

  const panels = page.locator(selectorList(GoogleSelectors.reviewPanels));
  for (let index = 0; index < (await panels.count()); index += 1) {
    const panel = panels.nth(index);
    if (!(await panel.isVisible())) {
      continue;
    }
    const role = await panel.getAttribute("role");
    const ariaLabel = (await panel.getAttribute("aria-label")) ?? "";
    const title = (await panel.getAttribute("title")) ?? "";
    if ([ariaLabel, title].some(isReviewsLabel)) {
      return true;
    }
    if (role === "dialog" && /reviews?|avis/i.test(await panel.innerText())) {
      return true;
    }
  }
  return false;
}

async function expandVisibleReviewText(
  page: CrawlerPage,
  maxReviews: number,
  timeoutMs: number,
  settleMs: number,
  expandedControls: Set<string>,
): Promise<void> {
  const cards = page.locator(selectorList(GoogleSelectors.reviewCards));
  let expandedCount = 0;
  for (
    let cardIndex = 0;
    cardIndex < (await cards.count()) && expandedCount < maxReviews;
    cardIndex += 1
  ) {
    const card = cards.nth(cardIndex);
    if (
      !(await card.isVisible()) ||
      (await card.locator(selectorList(GoogleSelectors.ratings)).count()) === 0
    ) {
      continue;
    }
    const controls = card.locator('button, [role="button"]');
    for (
      let controlIndex = 0;
      controlIndex < (await controls.count());
      controlIndex += 1
    ) {
      const control = controls.nth(controlIndex);
      const controlKey = `${cardIndex}:${controlIndex}`;
      if (
        !(await control.isVisible()) ||
        expandedControls.has(controlKey) ||
        !(await labels(control)).some(isReviewExpansionLabel)
      ) {
        continue;
      }
      try {
        await control.click({ timeout: timeoutMs });
        expandedControls.add(controlKey);
        expandedCount += 1;
        await page.waitForTimeout(settleMs);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google review expansion interaction failed.";
        throw new CrawlError("interaction_failure", message);
      }
      if (expandedCount >= maxReviews) {
        break;
      }
    }
  }
}

export class GoogleReviewInteraction {
  async waitForMapsContent(
    page: CrawlerPage,
    settleWaitMs: number,
  ): Promise<GoogleMapsReadinessResult> {
    const reviewsControlSearchStartedAt = new Date().toISOString();
    let waitedMs = 0;
    let mapsContentReady = false;
    while (true) {
      const control = await findReviewsControl(page);
      const reviewCardsFound = (await visibleReviewCardCount(page)) > 0;
      const heading = page.locator("h1").first();
      const headingText =
        (await heading.count()) > 0 && (await heading.isVisible())
          ? await heading.innerText()
          : "";
      const bodyText = await page.locator("body").innerText();
      mapsContentReady =
        Boolean(control) ||
        reviewCardsFound ||
        isHotelHeading(headingText) ||
        hasPlaceContentSignal(bodyText);
      if (
        mapsContentReady ||
        isProtectionPageText(bodyText) ||
        waitedMs >= settleWaitMs
      ) {
        break;
      }
      const intervalMs = Math.min(250, settleWaitMs - waitedMs);
      await page.waitForTimeout(intervalMs);
      waitedMs += intervalMs;
    }

    return {
      mapsContentReady,
      reviewsControlSearchStartedAt,
      reviewsControlSearchFinishedAt: new Date().toISOString(),
    };
  }

  async run(
    page: CrawlerPage,
    options: GoogleReviewInteractionOptions,
  ): Promise<GoogleReviewInteractionResult> {
    const panelOpeningStartedAt = Date.now();
    const reviewsControlSearchStartedAt =
      options.reviewsControlSearchStartedAt ?? new Date().toISOString();
    let reviewCardCountBeforeClick = await visibleReviewCardCount(page);
    let control = await findReviewsControl(page);
    if (!control && reviewCardCountBeforeClick === 0) {
      control = await waitForReviewsControl(page, options.panelWaitMs);
      reviewCardCountBeforeClick = await visibleReviewCardCount(page);
    }
    const reviewsControlSearchFinishedAt = new Date().toISOString();
    options.onProgress?.({ reviewCardCountBeforeClick });
    options.onProgress?.({
      reviewsControlSearchStartedAt,
      reviewsControlSearchFinishedAt,
    });
    let reviewsControlClicked = false;
    options.onProgress?.({
      reviewsControlFound: Boolean(control),
      reviewsControlClicked,
    });

    if (control) {
      try {
        await control.click({ timeout: options.timeoutMs });
        reviewsControlClicked = true;
        options.onProgress?.({ reviewsControlClicked });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google Reviews interaction failed.";
        throw new CrawlError("interaction_failure", message);
      }

      const waitLimitMs = Math.min(options.timeoutMs, options.panelWaitMs);
      const pollIntervalMs = 150;
      for (
        let waitedMs = 0;
        waitedMs < waitLimitMs;
        waitedMs += pollIntervalMs
      ) {
        if (await hasReviewsPanel(page)) {
          break;
        }
        await page.waitForTimeout(
          Math.min(pollIntervalMs, waitLimitMs - waitedMs),
        );
      }
    }

    const reviewsPanelFound = await hasReviewsPanel(page);
    const reviewCardCountAfterClick = await visibleReviewCardCount(page);
    const reviewPanelOpeningMs = Date.now() - panelOpeningStartedAt;
    options.onProgress?.({ reviewsPanelFound, reviewCardCountAfterClick });
    options.onProgress?.({ reviewPanelOpeningMs });
    const settleMs = options.interactionWaitMs;
    const reviewCardCountBeforeScroll = await visibleReviewCardCount(page);
    const reviewCardCountAfterEachScroll: number[] = [];
    const newReviewsPerScroll: number[] = [];
    const knownExternalReviewIds = new Set(options.persistedReviewIds ?? []);
    const seenExternalReviewIds = new Set<string>();
    const newExternalReviewIds = new Set<string>();
    let lastSeenBoundaryReached = false;
    for (const externalReviewId of await options.collectExternalReviewIds()) {
      seenExternalReviewIds.add(externalReviewId);
      if (externalReviewId === options.lastSeenReviewId) {
        lastSeenBoundaryReached = true;
        break;
      }
      if (!knownExternalReviewIds.has(externalReviewId)) {
        newExternalReviewIds.add(externalReviewId);
      }
    }
    let scrollAttempts = 0;
    let stoppedBecause: GoogleInteractionStopReason =
      "review_panel_unavailable";
    let scrollingMs = 0;
    options.onProgress?.({
      reviewCardCountBeforeScroll,
      reviewCardCountAfterEachScroll,
      newReviewsPerScroll,
      scrollAttempts,
      totalUniqueCardsSeen: seenExternalReviewIds.size,
      reviewPanelOpeningMs,
      scrollingMs,
    });

    if (reviewsPanelFound) {
      const expandedControls = new Set<string>();
      const scrollingStartedAt = Date.now();
      if (lastSeenBoundaryReached) {
        stoppedBecause = "last_seen_review_id_reached";
      } else if (newExternalReviewIds.size >= options.maxReviews) {
        stoppedBecause = "max_reviews_reached";
      } else {
        stoppedBecause = "max_scroll_attempts";
      }
      for (
        let scrollStep = 0;
        !lastSeenBoundaryReached &&
        newExternalReviewIds.size < options.maxReviews &&
        scrollStep < MAX_SCROLL_ATTEMPTS;
        scrollStep += 1
      ) {
        if (newExternalReviewIds.size >= options.maxReviews) {
          stoppedBecause = "max_reviews_reached";
          break;
        }
        await expandVisibleReviewText(
          page,
          options.maxReviews,
          options.timeoutMs,
          settleMs,
          expandedControls,
        );
        if (newExternalReviewIds.size >= options.maxReviews) {
          stoppedBecause = "max_reviews_reached";
          break;
        }
        scrollAttempts += 1;
        const scrolled = await page.scrollFirstScrollable(
          selectorList(GoogleSelectors.reviewPanelScrollRoots),
        );
        if (scrolled) {
          await page.waitForTimeout(settleMs);
        }
        const reviewCardCountAfterScroll = await visibleReviewCardCount(page);
        const currentExternalReviewIds =
          await options.collectExternalReviewIds();
        let newReviews = 0;
        for (const externalReviewId of currentExternalReviewIds) {
          if (seenExternalReviewIds.has(externalReviewId)) {
            continue;
          }
          seenExternalReviewIds.add(externalReviewId);
          if (externalReviewId === options.lastSeenReviewId) {
            lastSeenBoundaryReached = true;
            break;
          }
          if (!knownExternalReviewIds.has(externalReviewId)) {
            newExternalReviewIds.add(externalReviewId);
            newReviews += 1;
          }
        }
        reviewCardCountAfterEachScroll.push(reviewCardCountAfterScroll);
        newReviewsPerScroll.push(newReviews);
        options.onProgress?.({
          reviewCardCountAfterEachScroll: [...reviewCardCountAfterEachScroll],
          newReviewsPerScroll: [...newReviewsPerScroll],
          scrollAttempts,
          totalUniqueCardsSeen: seenExternalReviewIds.size,
          scrollingMs: Date.now() - scrollingStartedAt,
        });

        if (lastSeenBoundaryReached) {
          stoppedBecause = "last_seen_review_id_reached";
          break;
        }
        if (newExternalReviewIds.size >= options.maxReviews) {
          stoppedBecause = "max_reviews_reached";
          break;
        }
        if (!scrolled) {
          stoppedBecause = "no_scrollable_container";
          break;
        }
        if (newReviews === 0) {
          stoppedBecause = "no_new_cards";
          break;
        }
      }
      scrollingMs = Date.now() - scrollingStartedAt;
      options.onProgress?.({ scrollingMs });
    }

    return {
      reviewsControlFound: Boolean(control),
      reviewsControlClicked,
      reviewsControlSearchStartedAt,
      reviewsControlSearchFinishedAt,
      reviewsPanelFound,
      reviewCardCountBeforeClick,
      reviewCardCountAfterClick,
      reviewPanelOpeningMs,
      reviewCardCountBeforeScroll,
      reviewCardCountAfterEachScroll,
      scrollAttempts,
      newReviewsPerScroll,
      totalUniqueCardsSeen: seenExternalReviewIds.size,
      stoppedBecause,
      scrollingMs,
    };
  }
}
