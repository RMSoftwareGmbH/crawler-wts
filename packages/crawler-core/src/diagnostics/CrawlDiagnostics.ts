import type { ReviewSource } from "../../../crawler-contracts/src/source/sourceType.js";

export type CrawlFailureClassification =
  | "timeout"
  | "network_failure"
  | "proxy_failure"
  | "navigation_failure"
  | "blocked_page"
  | "restricted_maps_view"
  | "challenge_page"
  | "consent_page"
  | "authentication_required"
  | "selector_drift"
  | "interaction_failure"
  | "no_reviews_available"
  | "invalid_page"
  | "parser_failure"
  | "schema_validation_failure"
  | "pagination_failure"
  | "browser_failure"
  | "configuration_failure"
  | "resource_cleanup_failure";

export interface CrawlFailure {
  classification: CrawlFailureClassification;
  message: string;
}

export interface CrawlDiagnostics {
  crawlId: string;
  source: ReviewSource;
  hotelUrl: string;
  startedAt: string;
  finishedAt: string;
  pagesVisited: number;
  reviewsExtracted: number;
  reviewsAccepted: number;
  duplicatesRemoved: number;
  retries: number;
  crawlerVersion: string;
  finalUrl?: string;
  documentTitle?: string;
  navigationStatus?: number;
  navigationMs?: number;
  bodyTextLength?: number;
  hotelContentMarkerCount?: number;
  interstitialPageDetected?: boolean;
  guestReviewsControlFound?: boolean;
  guestReviewsControlClicked?: boolean;
  reviewPanelFound?: boolean;
  reviewPanelSelector?: string;
  reviewCardCountBeforeClick?: number;
  reviewCardCountAfterClick?: number;
  paginationControlFound?: boolean;
  paginationClicks?: number;
  interactionStoppedBecause?: string;
  interactionEnabled?: boolean;
  settleWaitMs?: number;
  optimizationEnabled?: boolean;
  abortedResourceTypes?: string[];
  mapsContentReady?: boolean;
  reviewsControlSearchStartedAt?: string;
  reviewsControlSearchFinishedAt?: string;
  pageClassification?: string;
  reviewCardCount?: number;
  reviewsInteractionAttempted?: boolean;
  reviewsControlFound?: boolean;
  reviewsControlClicked?: boolean;
  reviewsPanelFound?: boolean;
  moreReviewsControlClicked?: boolean;
  maxReviewsPerRun?: number;
  reviewCardCountBeforeScroll?: number;
  reviewCardCountAfterEachScroll?: number[];
  scrollAttempts?: number;
  newReviewsPerScroll?: number[];
  totalUniqueCardsSeen?: number;
  stoppedBecause?: string;
  paginationStoppedBecause?: string;
  reviewPanelOpeningMs?: number;
  parsingMs?: number;
  scrollingMs?: number;
  originalLanguageControlsFound?: number;
  originalLanguageControlsClicked?: number;
  originalLanguageControlsChanged?: number;
  consentPageDetected: boolean;
  challengePageDetected: boolean;
  authenticationPageDetected: boolean;
  restrictedMapsViewDetected: boolean;
  diagnosticSnapshot?: string;
  diagnosticScreenshotPath?: string;
  diagnosticDomPath?: string;
  failure?: CrawlFailure;
}
