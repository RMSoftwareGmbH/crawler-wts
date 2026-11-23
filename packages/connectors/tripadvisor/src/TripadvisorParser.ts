import { createHash } from "node:crypto";
import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";
import {
  normalizeText,
  normalizeLanguage,
  normalizeRating,
} from "../../../crawler-normalization/src/index.js";
import {
  TripadvisorSelectors as S,
  selectorList,
} from "./TripadvisorSelectors.js";

export interface ParsedTripadvisorReview {
  externalReviewId: string;
  rawRating?: string;
  title?: string;
  comment?: string;
  authorName?: string;
  authorProfileUrl?: string;
  rawDate?: string;
  language?: string;
  businessReply?: string;
  sourceUrl?: string;
}

async function firstText(
  root: CrawlerLocator,
  selectors: readonly string[],
): Promise<string | undefined> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0) {
      const text = normalizeText(await locator.innerText());
      if (text) return text;
    }
  }
  return undefined;
}

async function firstAttribute(
  root: CrawlerLocator,
  selectors: readonly string[],
  attribute: string,
): Promise<string | undefined> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0) {
      const value = normalizeText(
        (await locator.getAttribute(attribute)) ?? "",
      );
      if (value) return value;
    }
  }
  return undefined;
}

function fallbackId(
  review: Omit<ParsedTripadvisorReview, "externalReviewId">,
): string {
  const stable = [
    review.sourceUrl,
    review.authorName,
    review.rawDate,
    review.title,
    review.comment,
    review.rawRating,
  ]
    .map((value) => normalizeText(value) ?? "")
    .join("|");
  return `tripadvisor-${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

function publicUrl(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value, baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export class TripadvisorParser {
  async parse(
    page: CrawlerPage,
    sourceUrl = page.url(),
  ): Promise<ParsedTripadvisorReview[]> {
    const sanitizedSourceUrl = publicUrl(sourceUrl, sourceUrl) ?? "";
    const cards = page.locator(selectorList(S.reviewCards));
    const result: ParsedTripadvisorReview[] = [];
    for (let index = 0; index < (await cards.count()); index += 1) {
      const card = cards.nth(index);
      if (!(await card.isVisible())) {
        continue;
      }
      const rawRating =
        (await firstAttribute(card, S.rating, "aria-label")) ??
        (await firstAttribute(card, S.rating, "data-rating"));
      if (!rawRating || !normalizeRating(rawRating)) {
        continue;
      }
      const parsed: Omit<ParsedTripadvisorReview, "externalReviewId"> = {
        rawRating,
        title: await firstText(card, S.title),
        comment: await firstText(card, S.comment),
        authorName: await firstText(card, S.author),
        authorProfileUrl: sanitizedSourceUrl
          ? publicUrl(
              await firstAttribute(card, S.authorProfile, "href"),
              sanitizedSourceUrl,
            )
          : undefined,
        rawDate: await firstText(card, S.date),
        language: await firstAttribute(card, S.language, "lang"),
        businessReply: await firstText(card, S.businessReply),
        sourceUrl: sanitizedSourceUrl,
      };
      const explicitId =
        normalizeText((await card.getAttribute("data-review-id")) ?? "") ??
        normalizeText((await card.getAttribute("data-reviewid")) ?? "") ??
        (await firstAttribute(card, S.reviewId, "data-review-id")) ??
        (await firstAttribute(card, S.reviewId, "data-reviewid")) ??
        (await firstAttribute(card, S.reviewId, "id"));
      result.push({
        ...parsed,
        externalReviewId: explicitId ?? fallbackId(parsed),
      });
    }
    return result;
  }

  static normalizeLanguage(value?: string): string | undefined {
    return normalizeLanguage(value);
  }
}
