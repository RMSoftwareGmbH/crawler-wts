import {
  canonicalReviewSchema,
  type CanonicalReview,
} from "../../../crawler-contracts/src/index.js";
import type { CrawlRequest } from "../../../crawler-core/src/crawler/CrawlRequest.js";
import {
  normalizeDate,
  normalizeLanguage,
  normalizeText,
} from "../../../crawler-normalization/src/index.js";
import { normalizeExpediaRating } from "./ExpediaRating.js";
import type { ParsedExpediaReview } from "./ExpediaParser.js";

export const EXPEDIA_CRAWLER_VERSION = "1.0.0";
export const CANONICAL_SCHEMA_VERSION = "1.0.0";

export class ExpediaMapper {
  map(
    parsed: ParsedExpediaReview,
    request: CrawlRequest,
    fetchedAt: Date,
    hotelName?: string,
  ): CanonicalReview {
    const rating = normalizeExpediaRating(parsed.rawRating);
    if (!rating) throw new Error("Review has no valid Expedia rating.");
    const author = normalizeText(parsed.authorName);
    const title = normalizeText(parsed.title);
    const comment = normalizeText(parsed.comment);
    const reply = normalizeText(parsed.businessReply);
    const language = normalizeLanguage(parsed.language);
    const reviewDate = normalizeDate(parsed.rawDate, fetchedAt);
    return canonicalReviewSchema.parse({
      source: "expedia",
      externalReviewId: parsed.externalReviewId,
      hotel: {
        ...(request.hotel?.externalId
          ? { externalId: request.hotel.externalId }
          : {}),
        ...((request.hotel?.name ?? hotelName)
          ? { name: normalizeText(request.hotel?.name ?? hotelName) }
          : {}),
        ...(request.hotel?.address
          ? { address: normalizeText(request.hotel.address) }
          : {}),
        url: request.url,
      },
      rating,
      ...(title ? { title } : {}),
      ...(comment ? { comment } : {}),
      ...(author || parsed.authorProfileUrl
        ? {
            author: {
              ...(author ? { displayName: author } : {}),
              ...(parsed.authorProfileUrl
                ? { profileUrl: parsed.authorProfileUrl }
                : {}),
            },
          }
        : {}),
      ...(reviewDate ? { reviewDate } : {}),
      ...(language ? { language } : {}),
      ...(reply ? { businessReply: { text: reply } } : {}),
      sourceMetadata: {
        sourceUrl: parsed.sourceUrl,
        fetchedAt: fetchedAt.toISOString(),
        crawlerVersion: EXPEDIA_CRAWLER_VERSION,
        schemaVersion: CANONICAL_SCHEMA_VERSION,
      },
    });
  }
}
