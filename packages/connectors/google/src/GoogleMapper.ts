import {
  canonicalReviewSchema,
  type CanonicalReview,
} from "../../../crawler-contracts/src/index.js";
import type { CrawlRequest } from "../../../crawler-core/src/crawler/CrawlRequest.js";
import {
  normalizeDate,
  normalizeLanguage,
  normalizeRating,
  normalizeText,
} from "../../../crawler-normalization/src/index.js";
import type { ParsedGoogleReview } from "./GoogleParser.js";

export function normalizeGoogleReviewDate(
  value: string | undefined,
  referenceDate: Date,
): string | undefined {
  const arabicRelative = value
    ?.trim()
    .match(
      /^(?:قبل|منذ)\s*(?:([0-9٠-٩]+)\s*)?(يوم|أيام|أسبوع|أسابيع|شهر|أشهر|سنة|سنوات)$/u,
    );
  if (!arabicRelative) {
    return normalizeDate(value, referenceDate);
  }

  const amountText = arabicRelative[1]?.replace(/[٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - "٠".charCodeAt(0)),
  );
  const amount = amountText ? Number(amountText) : 1;
  const unit = arabicRelative[2];
  const normalizedUnit =
    unit === "يوم" || unit === "أيام"
      ? "day"
      : unit === "أسبوع" || unit === "أسابيع"
        ? "week"
        : unit === "شهر" || unit === "أشهر"
          ? "month"
          : "year";
  return normalizeDate(
    `${amount} ${normalizedUnit}${amount === 1 ? "" : "s"} ago`,
    referenceDate,
  );
}

export const GOOGLE_CRAWLER_VERSION = "1.0.0";
export const CANONICAL_SCHEMA_VERSION = "1.0.0";

export class GoogleMapper {
  map(
    parsed: ParsedGoogleReview,
    request: CrawlRequest,
    fetchedAt: Date,
    hotelName?: string,
  ): CanonicalReview {
    const rating = normalizeRating(parsed.rawRating);
    if (!rating) {
      throw new Error("Review has no valid Google rating.");
    }

    const authorName = normalizeText(parsed.authorName);
    const businessReply = normalizeText(parsed.businessReply);
    const sourceUrl = parsed.sourceUrl ?? request.url;
    const reviewDate = normalizeGoogleReviewDate(parsed.rawDate, fetchedAt);
    return canonicalReviewSchema.parse({
      source: "google",
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
      ...(normalizeText(parsed.title)
        ? { title: normalizeText(parsed.title) }
        : {}),
      ...(normalizeText(parsed.comment)
        ? { comment: normalizeText(parsed.comment) }
        : {}),
      ...(authorName || parsed.authorProfileUrl
        ? {
            author: {
              ...(authorName ? { displayName: authorName } : {}),
              ...(parsed.authorProfileUrl
                ? { profileUrl: parsed.authorProfileUrl }
                : {}),
            },
          }
        : {}),
      ...(reviewDate ? { reviewDate } : {}),
      ...(normalizeLanguage(parsed.language)
        ? { language: normalizeLanguage(parsed.language) }
        : {}),
      ...(businessReply ? { businessReply: { text: businessReply } } : {}),
      sourceMetadata: {
        sourceUrl,
        fetchedAt: fetchedAt.toISOString(),
        crawlerVersion: GOOGLE_CRAWLER_VERSION,
        schemaVersion: CANONICAL_SCHEMA_VERSION,
      },
    });
  }
}
