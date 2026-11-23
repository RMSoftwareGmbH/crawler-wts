import type { CrawlRequest } from "./CrawlRequest.js";
import type { CrawlResult } from "./CrawlResult.js";

export interface ReviewConnector {
  crawl(request: CrawlRequest): Promise<CrawlResult>;
  crawlBatch?(requests: readonly CrawlRequest[]): Promise<CrawlResult[]>;
}
