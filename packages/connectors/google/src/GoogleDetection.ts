import type { CrawlerPage } from "../../../crawler-core/src/browser/pageFactory.js";
import { normalizeText } from "../../../crawler-normalization/src/index.js";
import {
  countVisible,
  GoogleSelectors,
  selectorList,
} from "./GoogleSelectors.js";

export type GooglePageStatus =
  | "valid"
  | "blocked_page"
  | "restricted_maps_view"
  | "challenge_page"
  | "consent_page"
  | "authentication_required"
  | "invalid_page";

export interface GoogleDetectionResult {
  status: GooglePageStatus;
  reason?: string;
  reviewCardCount: number;
  detections: {
    consentPage: boolean;
    challengePage: boolean;
    authenticationPage: boolean;
    restrictedMapsView: boolean;
  };
}

export interface GoogleDetectionOptions {
  deferRestrictedMapsView?: boolean;
  deferUnrecognizedPlacePage?: boolean;
}

function isGoogleReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const googleHost = /(^|\.)google\.[a-z.]+$/.test(host);
    const reviewRoute =
      url.pathname.startsWith("/maps") ||
      url.pathname.startsWith("/travel/hotels") ||
      url.pathname.startsWith("/search");
    return url.protocol === "https:" && googleHost && reviewRoute;
  } catch {
    return false;
  }
}

function isGoogleMapsShortUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "maps.app.goo.gl"
    );
  } catch {
    return false;
  }
}

function hasHotelPlacePath(value: string): boolean {
  try {
    const url = new URL(value);
    const placeSlug = url.pathname.match(
      /^\/maps\/place\/([^/]+)(?:\/|$)/i,
    )?.[1];
    return Boolean(placeSlug && !placeSlug.startsWith("@"));
  } catch {
    return false;
  }
}

function isHotelHeading(value: string | undefined): boolean {
  return Boolean(
    value &&
    !/^(?:google maps|maps|google|google maps search|خرائط google)$/i.test(
      value,
    ),
  );
}

export class GoogleDetection {
  async classify(
    page: CrawlerPage,
    requestedUrl: string,
    options: GoogleDetectionOptions = {},
  ): Promise<GoogleDetectionResult> {
    const currentUrl = page.url();
    const [title, body] = await Promise.all([
      page.title(),
      page.locator("body").innerText(),
    ]);
    const content = `${title}\n${body}`.toLowerCase();
    const currentHost = safeHostname(currentUrl);
    const reviewCount = await countVisible(
      page.locator(selectorList(GoogleSelectors.reviewCards)),
    );
    const detections = {
      challengePage:
        /captcha|unusual traffic|automated quer|verify you are human|robot check/.test(
          content,
        ),
      restrictedMapsView:
        /limited (?:view|version) of (?:google maps|maps)/.test(content) ||
        /طريقة عرض محدودة/.test(content),
      consentPage:
        currentHost?.startsWith("consent.google.") === true ||
        /before you continue to google|consent.google|consent required|cookie consent/.test(
          content,
        ),
      authenticationPage:
        currentHost === "accounts.google.com" ||
        /sign in to continue|authentication required|accounts\.google\.com/.test(
          content,
        ),
    };
    const result = (
      status: GooglePageStatus,
      reason?: string,
    ): GoogleDetectionResult => ({
      status,
      ...(reason ? { reason } : {}),
      reviewCardCount: reviewCount,
      detections,
    });

    if (detections.challengePage) {
      return result(
        "challenge_page",
        "Google presented a bot or CAPTCHA challenge.",
      );
    }
    if (detections.consentPage) {
      return result("consent_page", "Google requires a consent action.");
    }
    if (detections.authenticationPage) {
      return result(
        "authentication_required",
        "The page requires Google authentication.",
      );
    }
    if (
      /access denied|request blocked|temporarily blocked|this page isn.t available/.test(
        content,
      )
    ) {
      return result("blocked_page", "Google blocked the requested page.");
    }
    if (
      detections.restrictedMapsView &&
      reviewCount === 0 &&
      !options.deferRestrictedMapsView
    ) {
      return result(
        "restricted_maps_view",
        "Google served a restricted Maps view without review content.",
      );
    }
    if (
      (!isGoogleReviewUrl(requestedUrl) &&
        !isGoogleMapsShortUrl(requestedUrl)) ||
      !isGoogleReviewUrl(currentUrl)
    ) {
      return result(
        "invalid_page",
        "The URL is not a supported Google hotel review page.",
      );
    }

    const heading = page.locator("h1").first();
    const headingText =
      (await heading.count()) > 0
        ? normalizeText(await heading.innerText())
        : undefined;
    const hasReviewSummary = /\b(?:no reviews|\d[\d,]* reviews?)\b/i.test(body);
    const hotelContext =
      hasHotelPlacePath(currentUrl) || isHotelHeading(headingText);
    if (
      reviewCount > 0 ||
      (hasReviewSummary && hotelContext) ||
      (hasHotelPlacePath(currentUrl) && isHotelHeading(headingText))
    ) {
      return result("valid");
    }
    if (
      options.deferUnrecognizedPlacePage &&
      hasHotelPlacePath(currentUrl)
    ) {
      return result("valid");
    }
    return result(
      "invalid_page",
      "The page did not contain recognizable hotel content.",
    );
  }
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
