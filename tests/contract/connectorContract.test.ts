import { describe, expect, it } from 'vitest';
import type { Crawler } from '../../packages/crawler-core/src/index.js';
import { GoogleCrawler } from '../../packages/connectors/google/src/GoogleCrawler.js';

describe('connector contract', () => {
  it('implements the shared crawler interface and returns diagnostics on invalid input', async () => {
    const crawler: Crawler = new GoogleCrawler({ maxRetries: 0 });
    const result = await crawler.crawl({ url: 'not-a-url' });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toMatchObject({
      source: 'google',
      pagesVisited: 0,
      retries: 0
    });
    expect(result.diagnostics.failure?.classification).toBe('invalid_page');
  });
});
