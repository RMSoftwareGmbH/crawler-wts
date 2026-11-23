import type { ReviewSource } from "../../crawler-contracts/src/source/sourceType.js";
import type { ReviewConnector } from "../../crawler-core/src/index.js";
import { BookingCrawler } from "../../connectors/booking/src/BookingCrawler.js";
import { ExpediaCrawler } from "../../connectors/expedia/src/ExpediaCrawler.js";
import { GoogleCrawler } from "../../connectors/google/src/GoogleCrawler.js";
import { HolidayCheckCrawler } from "../../connectors/holidaycheck/src/HolidayCheckCrawler.js";
import { HotelsComCrawler } from "../../connectors/hotels-com/src/HotelsComCrawler.js";
import { TripadvisorCrawler } from "../../connectors/tripadvisor/src/TripadvisorCrawler.js";

const connectorFactories: Record<ReviewSource, () => ReviewConnector> = {
  google: () => new GoogleCrawler(),
  tripadvisor: () => new TripadvisorCrawler(),
  booking: () => new BookingCrawler(),
  holidaycheck: () => new HolidayCheckCrawler(),
  expedia: () => new ExpediaCrawler(),
  "hotels-com": () => new HotelsComCrawler(),
};

export function isReviewSource(value: string): value is ReviewSource {
  return Object.hasOwn(connectorFactories, value);
}

export function supportedReviewSources(): ReviewSource[] {
  return Object.keys(connectorFactories) as ReviewSource[];
}

export function createReviewConnector(source: ReviewSource): ReviewConnector {
  return connectorFactories[source]();
}
