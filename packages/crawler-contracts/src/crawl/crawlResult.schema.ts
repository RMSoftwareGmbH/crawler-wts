import { z } from "zod";
import { canonicalReviewSchema } from "../review/canonicalReview.schema.js";

export const crawlResultSchema = z.object({
  success: z.boolean(),
  reviews: z.array(canonicalReviewSchema),
  diagnostics: z.object({
    crawlId: z.string().min(1),
    source: z.string().min(1),
    hotelUrl: z.string().min(1),
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }),
    pagesVisited: z.number().int().nonnegative(),
    reviewsExtracted: z.number().int().nonnegative(),
    reviewsAccepted: z.number().int().nonnegative(),
    duplicatesRemoved: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    crawlerVersion: z.string().min(1),
    finalUrl: z.string().optional(),
    documentTitle: z.string().optional(),
    navigationStatus: z.number().int().min(100).max(599).optional(),
    navigationMs: z.number().int().nonnegative().optional(),
    bodyTextLength: z.number().int().nonnegative().optional(),
    hotelContentMarkerCount: z.number().int().nonnegative().optional(),
    interstitialPageDetected: z.boolean().optional(),
    guestReviewsControlFound: z.boolean().optional(),
    guestReviewsControlClicked: z.boolean().optional(),
    reviewPanelFound: z.boolean().optional(),
    reviewPanelSelector: z.string().optional(),
    reviewCardCountBeforeClick: z.number().int().nonnegative().optional(),
    reviewCardCountAfterClick: z.number().int().nonnegative().optional(),
    paginationControlFound: z.boolean().optional(),
    paginationClicks: z.number().int().nonnegative().optional(),
    interactionStoppedBecause: z.string().optional(),
    interactionEnabled: z.boolean().optional(),
    settleWaitMs: z.number().int().nonnegative().optional(),
    optimizationEnabled: z.boolean().optional(),
    abortedResourceTypes: z.array(z.string().min(1)).optional(),
    mapsContentReady: z.boolean().optional(),
    reviewsControlSearchStartedAt: z
      .string()
      .datetime({ offset: true })
      .optional(),
    reviewsControlSearchFinishedAt: z
      .string()
      .datetime({ offset: true })
      .optional(),
    pageClassification: z.string().min(1).optional(),
    reviewCardCount: z.number().int().nonnegative().optional(),
    reviewsInteractionAttempted: z.boolean().optional(),
    reviewsControlFound: z.boolean().optional(),
    reviewsControlClicked: z.boolean().optional(),
    reviewsPanelFound: z.boolean().optional(),
    maxReviewsPerRun: z.number().int().positive().optional(),
    reviewCardCountBeforeScroll: z.number().int().nonnegative().optional(),
    reviewCardCountAfterEachScroll: z
      .array(z.number().int().nonnegative())
      .optional(),
    scrollAttempts: z.number().int().nonnegative().optional(),
    newReviewsPerScroll: z.array(z.number().int().nonnegative()).optional(),
    totalUniqueCardsSeen: z.number().int().nonnegative().optional(),
    stoppedBecause: z.string().min(1).optional(),
    paginationStoppedBecause: z.string().min(1).optional(),
    reviewPanelOpeningMs: z.number().int().nonnegative().optional(),
    parsingMs: z.number().int().nonnegative().optional(),
    scrollingMs: z.number().int().nonnegative().optional(),
    consentPageDetected: z.boolean(),
    challengePageDetected: z.boolean(),
    authenticationPageDetected: z.boolean(),
    restrictedMapsViewDetected: z.boolean(),
    diagnosticSnapshot: z.string().max(50_000).optional(),
    diagnosticScreenshotPath: z.string().min(1).optional(),
    diagnosticDomPath: z.string().min(1).optional(),
    failure: z
      .object({
        classification: z.string().min(1),
        message: z.string().min(1),
      })
      .optional(),
  }),
});
