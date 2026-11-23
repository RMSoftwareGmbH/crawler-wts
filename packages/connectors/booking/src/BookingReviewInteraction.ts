import {
  CrawlError,
  type CrawlFailureClassification,
  type CrawlerLocator,
  type CrawlerPage,
} from "../../../crawler-core/src/index.js";
import {
  BookingSelectors as S,
  bookingSelectorList,
} from "./BookingSelectors.js";

const MAX_PANEL_OPEN_WAIT_MS = 5_000;

export interface BookingReviewInteractionResult {
  guestReviewsControlFound: boolean;
  guestReviewsControlClicked: boolean;
  reviewPanelFound: boolean;
  reviewPanelSelector?: string;
  reviewCardCountBeforeClick: number;
  reviewCardCountAfterClick: number;
  panel?: CrawlerLocator;
  interactionStoppedBecause?: string;
  failure?: CrawlError;
}

interface PanelCandidate {
  locator: CrawlerLocator;
  selector: string;
  reviewCardCount: number;
  noReviewsAvailable: boolean;
}

function normalizedName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isReviewLabel(value: string): boolean {
  const name = normalizedName(value);
  return /(?:^|\s)(?:guest\s+)?reviews?(?:\s|$)|bewertungen|(?:^|\s)avis(?:\s|$)|beoordelingen|recension(?:e|i)|opiniones|comentarios|resenas/.test(
    name,
  );
}

function noReviewsAvailable(text: string): boolean {
  return /(?:no reviews(?: yet)?|there are no reviews|no guest reviews|keine bewertungen|keine gäste?bewertungen|aucun avis|sin comentarios|nessuna recensione|geen beoordelingen|没有住客点评)/i.test(
    text,
  );
}

function protectionFailure(
  title: string,
  text: string,
  hasReviewCards = false,
): CrawlError | undefined {
  const content = `${title}\n${text}`;
  let classification: CrawlFailureClassification | undefined;
  let message: string | undefined;
  if (
    /captcha|verify you are human|unusual traffic|robot check|challenge page|cloudflare|datadome|security check|verify your browser|checking your browser|enable javascript and cookies|\bchal_t=/i.test(
      content,
    )
  ) {
    classification = "challenge_page";
    message = "Booking.com served a challenge page.";
  } else if (
    /access denied|request blocked|too many requests|forbidden/i.test(content)
  ) {
    classification = "blocked_page";
    message = "Booking.com blocked the public crawl request.";
  } else if (
    !hasReviewCards &&
    /accept cookies|cookie consent|consent preferences|we use cookies/i.test(
      content,
    )
  ) {
    classification = "consent_page";
    message = "Booking.com served a consent page without review content.";
  } else if (
    !hasReviewCards &&
    /sign in to continue|log in to continue|authentication required|please sign in to view/i.test(
      content,
    )
  ) {
    classification = "authentication_required";
    message = "Booking.com requires authentication.";
  }
  return classification && message
    ? new CrawlError(classification, message)
    : undefined;
}

async function matchingControl(
  page: CrawlerPage,
  selectors: readonly string[],
  attributes: readonly string[],
  allowTextMatch: boolean,
): Promise<CrawlerLocator | undefined> {
  const controls = page.locator(bookingSelectorList(selectors));
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;

    for (const attribute of attributes) {
      const value = (await control.getAttribute(attribute)) ?? "";
      if (isReviewLabel(value)) return control;
    }

    if (allowTextMatch && isReviewLabel(await control.innerText())) {
      return control;
    }
  }
  return undefined;
}

async function findGuestReviewsControl(
  page: CrawlerPage,
): Promise<CrawlerLocator | undefined> {
  const accessibleOrStableControl = await matchingControl(
    page,
    S.guestReviewsControl,
    ["aria-label", "title", "data-testid", "data-test-id"],
    false,
  );
  if (accessibleOrStableControl) return accessibleOrStableControl;

  return matchingControl(page, S.guestReviewsTextControl, [], true);
}

async function findReviewPanel(
  page: CrawlerPage,
): Promise<PanelCandidate | undefined> {
  for (const selector of S.reviewPanels) {
    const panels = page.locator(selector);
    for (let index = 0; index < (await panels.count()); index += 1) {
      const panel = panels.nth(index);
      if (!(await panel.isVisible())) continue;

      const text = await panel.innerText();
      const reviewCardCount = await panel
        .locator(bookingSelectorList(S.reviewCards))
        .count();
      const hasReviewContent =
        reviewCardCount > 0 || isReviewLabel(text) || noReviewsAvailable(text);
      if (!hasReviewContent) continue;

      return {
        locator: panel,
        selector,
        reviewCardCount,
        noReviewsAvailable: noReviewsAvailable(text),
      };
    }
  }
  return undefined;
}

export class BookingReviewInteraction {
  async open(
    page: CrawlerPage,
    timeoutMs: number,
  ): Promise<BookingReviewInteractionResult> {
    const waitBudgetMs = Math.min(
      MAX_PANEL_OPEN_WAIT_MS,
      Math.max(0, timeoutMs),
    );
    const result: BookingReviewInteractionResult = {
      guestReviewsControlFound: false,
      guestReviewsControlClicked: false,
      reviewPanelFound: false,
      reviewCardCountBeforeClick: await page
        .locator(bookingSelectorList(S.reviewCards))
        .count(),
      reviewCardCountAfterClick: 0,
    };
    const deadline = Date.now() + waitBudgetMs;

    const control = await findGuestReviewsControl(page);
    if (!control) {
      const [title, body] = await Promise.all([
        page.title(),
        page.locator("body").innerText(),
      ]);
      result.interactionStoppedBecause = "guest_reviews_control_not_found";
      result.failure =
        protectionFailure(title, body, result.reviewCardCountBeforeClick > 0) ??
        (noReviewsAvailable(body)
          ? new CrawlError(
              "no_reviews_available",
              "Booking.com hotel page reports no available reviews.",
            )
          : new CrawlError(
              "interaction_failure",
              "Booking.com Guest Reviews control was not found.",
            ));
      return result;
    }
    result.guestReviewsControlFound = true;

    const clickTimeoutMs = Math.floor(deadline - Date.now());
    if (clickTimeoutMs <= 0) {
      result.interactionStoppedBecause = "timeout_before_control_click";
      result.failure = new CrawlError(
        "interaction_failure",
        "Timed out before clicking the Booking.com Guest Reviews control.",
      );
      return result;
    }

    try {
      await control.click({ timeout: clickTimeoutMs });
      result.guestReviewsControlClicked = true;
    } catch {
      result.interactionStoppedBecause = "guest_reviews_control_click_failed";
      result.failure = new CrawlError(
        "interaction_failure",
        "Booking.com Guest Reviews control could not be clicked.",
      );
      return result;
    }

    let panel: PanelCandidate | undefined;
    let scheduledWaitMs = 0;
    while (true) {
      const [title, body, reviewCardCount] = await Promise.all([
        page.title(),
        page.locator("body").innerText(),
        page.locator(bookingSelectorList(S.reviewCards)).count(),
      ]);
      const protection = protectionFailure(title, body, reviewCardCount > 0);
      if (protection) {
        result.interactionStoppedBecause = `page_${protection.classification}`;
        result.failure = protection;
        return result;
      }

      panel = await findReviewPanel(page);
      if (panel) {
        result.reviewPanelFound = true;
        result.reviewPanelSelector = panel.selector;
        result.panel = panel.locator;
        result.reviewCardCountAfterClick = panel.reviewCardCount;
        if (panel.reviewCardCount > 0) {
          result.interactionStoppedBecause = "review_cards_found";
          return result;
        }
        if (panel.noReviewsAvailable) {
          result.interactionStoppedBecause = "no_reviews_available";
          result.failure = new CrawlError(
            "no_reviews_available",
            "Booking.com review panel reports no available reviews.",
          );
          return result;
        }
      }

      const remainingMs = Math.min(
        waitBudgetMs - scheduledWaitMs,
        deadline - Date.now(),
      );
      if (remainingMs <= 0) break;
      const delayMs = Math.min(100, remainingMs);
      await page.waitForTimeout(delayMs);
      scheduledWaitMs += delayMs;
    }

    if (result.reviewPanelFound) {
      result.interactionStoppedBecause = "review_panel_has_no_cards";
      result.failure = new CrawlError(
        "selector_drift",
        "Booking.com review panel opened but contained no recognizable review cards.",
      );
    } else {
      result.interactionStoppedBecause = "review_panel_not_found";
      result.failure = new CrawlError(
        "interaction_failure",
        "Booking.com Guest Reviews control was clicked, but no review panel appeared.",
      );
    }
    return result;
  }
}
