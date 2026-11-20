import type { HotelIdentity } from '../../../crawler-contracts/src/hotel/hotelIdentity.js';

export interface CrawlRequest {
  url: string;
  hotel?: Omit<HotelIdentity, 'url'>;
  maxPages?: number;
  maxReviews?: number;
  timeoutMs?: number;
  locale?: string;
  proxyEnabled?: boolean;
  lastSeenReviewId?: string;
  lastSuccessfulCrawlAt?: string;
  persistedReviewIds?: string[];
}