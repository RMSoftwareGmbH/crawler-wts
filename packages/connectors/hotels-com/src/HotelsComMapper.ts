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
import { normalizeHotelsComRating } from "./HotelsComRating.js";
import type { ParsedHotelsComReview } from "./HotelsComParser.js";

export const HOTELS_COM_CRAWLER_VERSION = "1.0.0";
export const CANONICAL_SCHEMA_VERSION = "1.0.0";

export class HotelsComMapper {
  map(
    parsed: ParsedHotelsComReview,
    request: CrawlRequest,
    fetchedAt: Date,
    hotelName?: string,
  ): CanonicalReview {
    const rating = normalizeHotelsComRating(parsed.rawRating);
    if (!rating) throw new Error("Review has no valid Hotels.com rating.");
    const author = normalizeText(parsed.authorName);
    const title = normalizeText(parsed.title);
    const comment = normalizeText(parsed.comment);
    const reply = normalizeText(parsed.businessReply);
    const language = normalizeLanguage(parsed.language);
    const reviewDate = normalizeDate(parsed.rawDate, fetchedAt);
    return canonicalReviewSchema.parse({
      source: "hotels-com",
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
        crawlerVersion: HOTELS_COM_CRAWLER_VERSION,
        schemaVersion: CANONICAL_SCHEMA_VERSION,
      },
    });
  }
}
