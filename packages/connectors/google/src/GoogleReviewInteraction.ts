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
import {
  loadGoogleScrollConfig,
  type GoogleScrollConfig,
} from "./GoogleScrollConfig.js";
import {
  isFullReviewsLabel,
  isShowOriginalLabel,
  normalizeUiLabel,
} from "./GoogleLabels.js";
import {
  readRootState,
  scrollRootBy,
  selectScrollRoot,
  supportsDomScrolling,
  wheelScrollRoot,
  type AncestorInfo,
  type EvaluablePage,
  type RootState,
  type ScrollMetrics,
  type ScrollRootCandidate,
} from "./GoogleScrollRoot.js";

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
  moreReviewsControlClicked: boolean;
  originalLanguageControlsFound: number;
  originalLanguageControlsClicked: number;
  originalLanguageControlsChanged: number;
  scrollRoot?: ScrollRootCandidate;
  scrollRootCandidates: ScrollRootCandidate[];
  /** Ancestors of the first review card; filled only when no scroll root qualified. */
  scrollAncestorChain: AncestorInfo[];
  /** Safe categories of visible review-related controls; never raw labels or personal data. */
  reviewControlLabelsSeen: string[];
  scrollSteps: GoogleScrollStepDiagnostics[];
  /** Set when stoppedBecause is "protection_page": the blocked/challenge/consent status. */
  protectionStatus?: string;
}

export interface GoogleScrollStepDiagnostics {
  step: number;
  /** "none": no valid root was found. "legacy_unverified": fixtures only; nothing measured. */
  method: "element" | "wheel" | "legacy_unverified" | "none";
  moved: boolean;
  scrollTopBefore: number;
  scrollTopAfter: number;
  scrollHeightBefore: number;
  scrollHeightAfter: number;
  clientHeight: number;
  visibleCards: number;
  totalUniqueReviewIds: number;
  newReviewIds: number;
  waitedMs: number;
  stopReason?: GoogleInteractionStopReason;
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
  | "end_of_container"
  | "timeout_reached"
  | "protection_page"
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
  /**
   * Fixtures only. Allows pages without evaluate()/mouse to scroll through
   * scrollFirstScrollable(). Such scrolls are never reported as moved.
   */
  allowUnverifiedLegacyScroll?: boolean;
  /** Scroll limits; defaults to the GOOGLE_* environment variables. */
  scroll?: GoogleScrollConfig;
  /** Absolute epoch-ms deadline for the scrolling phase. */
  deadlineAt?: number;
  /**
   * Returns a status such as "challenge_page" when the page is no longer a
   * valid review page, or undefined when it is fine.
   */
  checkPageState?: () => Promise<string | undefined>;
  onProgress?: (progress: Partial<GoogleReviewInteractionResult>) => void;
}

function isReviewsLabel(value: string): boolean {
  return /^(?:reviews?|avis|التقييمات|المراجعات|مراجعات|تقييمات)(?:\b|\s|\(|$)/i.test(
    value.trim(),
  );
}

function isReviewExpansionLabel(value: string): boolean {
  return /^(?:more|plus)$/i.test(value.trim());
}

async function rawReviewCardCount(page: CrawlerPage): Promise<number> {
  return page.locator(selectorList(GoogleSelectors.reviewCards)).count();
}

/** Polls the raw card count until it changes or maxWaitMs elapses; returns time waited. */
async function waitForCardCountChange(
  page: CrawlerPage,
  before: number,
  maxWaitMs: number,
): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    await page.waitForTimeout(
      Math.max(1, Math.min(150, maxWaitMs - (Date.now() - startedAt))),
    );
    if ((await rawReviewCardCount(page)) !== before) {
      await page.waitForTimeout(Math.min(200, maxWaitMs));
      break;
    }
  }
  return Date.now() - startedAt;
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
    const cardId =
      (await card.getAttribute("data-review-id")) ??
      (await card.getAttribute("data-reviewid"));
    if (cardId && expandedControls.has(`card:${cardId}`)) {
      continue;
    }
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
      const controlKey = `${cardId ?? cardIndex}:${controlIndex}`;
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
    if (cardId) {
      expandedControls.add(`card:${cardId}`);
    }
  }
}

async function showOriginalReviewText(
  page: CrawlerPage,
  maxReviews: number,
  timeoutMs: number,
  settleMs: number,
): Promise<{ found: number; clicked: number; changed: number }> {
  const cards = page.locator(selectorList(GoogleSelectors.reviewCards));
  let found = 0;
  let clicked = 0;
  let changed = 0;
  for (
    let cardIndex = 0;
    cardIndex < (await cards.count()) && clicked < maxReviews;
    cardIndex += 1
  ) {
    const card = cards.nth(cardIndex);
    if (
      !(await card.isVisible()) ||
      (await card.locator(selectorList(GoogleSelectors.ratings)).count()) === 0
    ) {
      continue;
    }

    const controls = card.locator('button, [role="button"], a');
    for (
      let controlIndex = 0;
      controlIndex < (await controls.count());
      controlIndex += 1
    ) {
      const control = controls.nth(controlIndex);
      if (
        !(await control.isVisible()) ||
        !(await labels(control)).some(isShowOriginalLabel)
      ) {
        continue;
      }

      found += 1;
      const comment = card
        .locator(selectorList(GoogleSelectors.comments))
        .first();
      const commentCount = await comment.count();
      const textBefore = commentCount > 0 ? await comment.innerText() : "";
      try {
        await control.click({ timeout: timeoutMs });
        clicked += 1;
        const waitLimitMs = Math.min(Math.max(settleMs, 100), 750);
        const startedAt = Date.now();
        while (Date.now() - startedAt < waitLimitMs) {
          if ((await control.count()) === 0) {
            changed += 1;
            break;
          }
          const currentLabels = await labels(control);
          const textAfter = commentCount > 0 ? await comment.innerText() : "";
          if (
            !currentLabels.some(isShowOriginalLabel) ||
            textAfter !== textBefore
          ) {
            changed += 1;
            break;
          }
          await page.waitForTimeout(
            Math.min(100, waitLimitMs - (Date.now() - startedAt)),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google original-review interaction failed.";
        throw new CrawlError("interaction_failure", message);
      }
      break;
    }
  }
  return { found, clicked, changed };
}

/**
 * Clicks the normal full-reviews control ("More reviews", "See all reviews",
 * "Plus d'avis", ...) once when it is visible. Also returns the labels of
 * visible review-related buttons so a missing match can be diagnosed.
 */
async function openFullReviewsView(
  page: CrawlerPage,
  timeoutMs: number,
  waitMs: number,
): Promise<{ clicked: boolean; labelsSeen: string[] }> {
  const labelsSeen: string[] = [];
  const controls = page.locator('button, [role="button"], [role="tab"], a');
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) {
      continue;
    }
    const controlLabels = (await labels(control)).map(normalizeUiLabel);
    if (controlLabels.some(isFullReviewsLabel)) {
      const before = await rawReviewCardCount(page);
      try {
        await control.click({ timeout: timeoutMs });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google full reviews interaction failed.";
        throw new CrawlError("interaction_failure", message);
      }
      await waitForCardCountChange(page, before, waitMs);
      return { clicked: true, labelsSeen };
    }
    const category = controlLabels.some(isReviewsLabel)
      ? "reviews_control"
      : controlLabels.some(isShowOriginalLabel)
        ? "show_original_control"
        : controlLabels.some(isReviewExpansionLabel)
          ? "review_expansion_control"
          : undefined;
    if (category && labelsSeen.length < 15 && !labelsSeen.includes(category)) {
      labelsSeen.push(category);
    }
  }
  return { clicked: false, labelsSeen };
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
    let originalLanguageControlsFound = 0;
    let originalLanguageControlsClicked = 0;
    let originalLanguageControlsChanged = 0;
    if (reviewsPanelFound) {
      const originalText = await showOriginalReviewText(
        page,
        options.maxReviews,
        options.timeoutMs,
        options.interactionWaitMs,
      );
      originalLanguageControlsFound += originalText.found;
      originalLanguageControlsClicked += originalText.clicked;
      originalLanguageControlsChanged += originalText.changed;
      options.onProgress?.({
        originalLanguageControlsFound,
        originalLanguageControlsClicked,
        originalLanguageControlsChanged,
      });
    }
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

    const scrollConfig = options.scroll ?? loadGoogleScrollConfig();
    const scrollSteps: GoogleScrollStepDiagnostics[] = [];
    let scrollRoot: ScrollRootCandidate | undefined;
    let scrollRootCandidates: ScrollRootCandidate[] = [];
    let scrollAncestorChain: AncestorInfo[] = [];
    let protectionStatus: string | undefined;
    let moreReviewsControlClicked = false;
    let reviewControlLabelsSeen: string[] = [];

    if (reviewsPanelFound) {
      const expandedControls = new Set<string>();
      const scrollingStartedAt = Date.now();
      const deadlineAt =
        options.deadlineAt ?? scrollingStartedAt + scrollConfig.crawlTimeoutMs;
      const domScrolling = supportsDomScrolling(page);
      const evaluable = page as EvaluablePage; // only used when domScrolling is true
      if (lastSeenBoundaryReached) {
        stoppedBecause = "last_seen_review_id_reached";
      } else if (newExternalReviewIds.size >= options.maxReviews) {
        stoppedBecause = "max_reviews_reached";
      } else {
        stoppedBecause = "max_scroll_attempts";
        if (!domScrolling && !options.allowUnverifiedLegacyScroll) {
          // A capability gap is a bug, not a site state: fail loudly instead of reporting fake movement.
          throw new CrawlError(
            "interaction_failure",
            "Google review scrolling cannot be verified: the browser page does not expose evaluate() and mouse.move()/wheel(). Expose them on CrawlerPage.",
          );
        }
        // Prefer the normal full-reviews control, once, before scrolling.
        const opened = await openFullReviewsView(
          page,
          options.timeoutMs,
          scrollConfig.scrollWaitMs,
        );
        moreReviewsControlClicked = opened.clicked;
        reviewControlLabelsSeen = opened.labelsSeen;
        options.onProgress?.({
          moreReviewsControlClicked,
          reviewControlLabelsSeen,
        });
      }
      const cardSelector = selectorList(GoogleSelectors.reviewCards);
      const legacySelector = selectorList(
        GoogleSelectors.reviewPanelScrollRoots,
      );
      let consecutiveNoProgress = 0;
      let rootSignature = "";

      for (
        let scrollStep = 0;
        scrollStep < scrollConfig.maxScrollAttempts;
        scrollStep += 1
      ) {
        if (lastSeenBoundaryReached) {
          stoppedBecause = "last_seen_review_id_reached";
          break;
        }
        if (newExternalReviewIds.size >= options.maxReviews) {
          stoppedBecause = "max_reviews_reached";
          break;
        }
        if (Date.now() >= deadlineAt) {
          stoppedBecause = "timeout_reached";
          break;
        }
        await expandVisibleReviewText(
          page,
          options.maxReviews,
          options.timeoutMs,
          options.interactionWaitMs,
          expandedControls,
        );
        if (newExternalReviewIds.size >= options.maxReviews) {
          stoppedBecause = "max_reviews_reached";
          break;
        }

        scrollAttempts += 1;
        const cardsBefore = await rawReviewCardCount(page);
        const zero: RootState = {
          scrollTop: 0,
          scrollHeight: 0,
          clientHeight: 0,
          visible: false,
        };
        let method: GoogleScrollStepDiagnostics["method"] = "none";
        let before: ScrollMetrics = zero;
        let after: RootState = zero;
        let moved = false;
        let invalidRoot = false;
        let legacyAttempted = false;

        if (domScrolling) {
          // Re-select every step so a re-rendered panel never leaves a stale root.
          const selection = await selectScrollRoot(evaluable, cardSelector);
          scrollRootCandidates = selection.candidates;
          scrollAncestorChain = selection.ancestorChain;
          const selected = selection.selected;
          if (selected) {
            const signature = `${selected.tag}|${selected.role}|${selected.ariaLabel}|${selected.className}`;
            if (signature !== rootSignature) {
              rootSignature = signature;
              scrollRoot = selected;
            }
          }
          options.onProgress?.({
            scrollRootCandidates,
            scrollAncestorChain,
            ...(scrollRoot ? { scrollRoot } : {}),
          });
          if (!selected) {
            invalidRoot = true;
          } else {
            const step = await scrollRootBy(evaluable, 0.8);
            if (!step || !step.after.visible || step.after.clientHeight <= 0) {
              invalidRoot = true;
            } else {
              method = "element";
              before = step.before;
              after = step.after;
              moved = after.scrollTop > before.scrollTop;
              if (!moved) {
                // Element scroll did not move the list: one normal mouse-wheel scroll, then measure again.
                if (await wheelScrollRoot(evaluable, 0.8)) {
                  method = "wheel";
                  await page.waitForTimeout(100);
                  after = (await readRootState(evaluable)) ?? zero;
                  moved = after.scrollTop > before.scrollTop;
                }
              }
            }
          }
        } else {
          // Test fixtures only (allowUnverifiedLegacyScroll). Nothing is measured, so moved stays false.
          method = "legacy_unverified";
          legacyAttempted = await page.scrollFirstScrollable(legacySelector);
          invalidRoot = !legacyAttempted;
        }

        const waitedMs = invalidRoot
          ? 0
          : await waitForCardCountChange(
              page,
              cardsBefore,
              scrollConfig.scrollWaitMs,
            );
        if (domScrolling && !invalidRoot) {
          const settled = await readRootState(evaluable);
          if (
            !settled ||
            !settled.visible ||
            settled.clientHeight <= 0 ||
            settled.scrollHeight <= settled.clientHeight
          ) {
            invalidRoot = true; // the root detached, hid or collapsed
          } else {
            after = settled;
            // Movement counts only when measured: scrollTop advanced or the list grew after loading.
            moved =
              after.scrollTop > before.scrollTop ||
              after.scrollHeight > before.scrollHeight;
          }
        }
        const visibleCards = await visibleReviewCardCount(page);

        const originalText = await showOriginalReviewText(
          page,
          options.maxReviews,
          options.timeoutMs,
          options.interactionWaitMs,
        );
        originalLanguageControlsFound += originalText.found;
        originalLanguageControlsClicked += originalText.clicked;
        originalLanguageControlsChanged += originalText.changed;

        let newReviews = 0;
        for (const externalReviewId of await options.collectExternalReviewIds()) {
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
        reviewCardCountAfterEachScroll.push(visibleCards);
        newReviewsPerScroll.push(newReviews);
        consecutiveNoProgress =
          newReviews === 0 ? consecutiveNoProgress + 1 : 0;
        const atEnd =
          domScrolling &&
          !invalidRoot &&
          after.scrollTop + after.clientHeight >= after.scrollHeight - 2;

        let stop: GoogleInteractionStopReason | undefined;
        if (lastSeenBoundaryReached) {
          stop = "last_seen_review_id_reached";
        } else if (newExternalReviewIds.size >= options.maxReviews) {
          stop = "max_reviews_reached";
        } else if (invalidRoot && newReviews === 0) {
          stop = "no_scrollable_container";
        } else if (
          options.checkPageState &&
          (newReviews === 0 || scrollStep % 5 === 4)
        ) {
          const state = await options.checkPageState();
          if (state) {
            protectionStatus = state;
            stop = "protection_page";
          }
        }
        if (!stop) {
          if (consecutiveNoProgress >= scrollConfig.noProgressLimit) {
            if (atEnd) {
              stop = "end_of_container";
            } else if (!moved) {
              stop = "no_new_cards";
            }
          } else if (Date.now() >= deadlineAt) {
            stop = "timeout_reached";
          }
        }

        scrollSteps.push({
          step: scrollAttempts,
          method,
          moved,
          scrollTopBefore: before.scrollTop,
          scrollTopAfter: after.scrollTop,
          scrollHeightBefore: before.scrollHeight,
          scrollHeightAfter: after.scrollHeight,
          clientHeight: after.clientHeight,
          visibleCards,
          totalUniqueReviewIds: seenExternalReviewIds.size,
          newReviewIds: newReviews,
          waitedMs,
          ...(stop ? { stopReason: stop } : {}),
        });
        options.onProgress?.({
          reviewCardCountAfterEachScroll: [...reviewCardCountAfterEachScroll],
          newReviewsPerScroll: [...newReviewsPerScroll],
          scrollSteps: [...scrollSteps],
          scrollAttempts,
          totalUniqueCardsSeen: seenExternalReviewIds.size,
          originalLanguageControlsFound,
          originalLanguageControlsClicked,
          originalLanguageControlsChanged,
          scrollingMs: Date.now() - scrollingStartedAt,
        });
        if (stop) {
          stoppedBecause = stop;
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
      moreReviewsControlClicked,
      originalLanguageControlsFound,
      originalLanguageControlsClicked,
      originalLanguageControlsChanged,
      ...(scrollRoot ? { scrollRoot } : {}),
      scrollRootCandidates,
      scrollAncestorChain,
      reviewControlLabelsSeen,
      scrollSteps,
      ...(protectionStatus ? { protectionStatus } : {}),
    };
  }
}
