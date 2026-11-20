import type { CrawlRequest } from './CrawlRequest.js';
import type { CrawlResult } from './CrawlResult.js';

export interface Crawler {
  crawl(request: CrawlRequest): Promise<CrawlResult>;
}