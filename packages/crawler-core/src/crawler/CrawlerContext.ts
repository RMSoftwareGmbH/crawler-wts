import type { BrowserSession } from '../browser/pageFactory.js';

export interface CrawlerContext {
  session: BrowserSession;
  timeoutMs: number;
  locale?: string;
}