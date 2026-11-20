import { parseArgs } from 'node:util';
import 'dotenv/config';
import { GoogleCrawler } from '../packages/connectors/google/src/GoogleCrawler.js';

const { values } = parseArgs({
  options: {
    connector: { type: 'string' },
    url: { type: 'string', multiple: true },
    'max-pages': { type: 'string' },
    'max-reviews': { type: 'string' },
    timeout: { type: 'string' },
    locale: { type: 'string' },
    'last-seen-review-id': { type: 'string' },
    'last-successful-crawl-at': { type: 'string' },
    'persisted-review-id': { type: 'string', multiple: true },
    proxy: { type: 'boolean', default: false },
    'no-proxy': { type: 'boolean', default: false }
  }
});

const urls = values.url ?? [];
const [firstUrl, ...additionalUrls] = urls;
if (!values.connector || !firstUrl) {
  console.error(
    'Usage: pnpm tsx scripts/run-connector.ts --connector google --url <hotel-url> [--url <hotel-url> ...] [--max-pages N] [--max-reviews N] [--timeout MS] [--locale TAG] [--last-seen-review-id ID] [--last-successful-crawl-at ISO] [--persisted-review-id ID ...] [--proxy|--no-proxy]'
  );
  process.exit(1);
}

if (values.connector !== 'google') {
  console.error(`Unsupported connector '${values.connector}'. Only 'google' is implemented.`);
  process.exit(1);
}

if (values.proxy && values['no-proxy']) {
  console.error('Choose either --proxy or --no-proxy.');
  process.exit(1);
}

function positiveInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    console.error(`--${option} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

const maxPages = positiveInteger(values['max-pages'], 'max-pages');
const maxReviews = positiveInteger(values['max-reviews'], 'max-reviews');
const timeoutMs = positiveInteger(values.timeout, 'timeout');
const commonRequest = {
  ...(maxPages !== undefined ? { maxPages } : {}),
  ...(maxReviews !== undefined ? { maxReviews } : {}),
  ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  ...(values.locale ? { locale: values.locale } : {}),
  ...(values['last-seen-review-id']
    ? { lastSeenReviewId: values['last-seen-review-id'] }
    : {}),
  ...(values['last-successful-crawl-at']
    ? { lastSuccessfulCrawlAt: values['last-successful-crawl-at'] }
    : {}),
  ...(values['persisted-review-id']
    ? { persistedReviewIds: values['persisted-review-id'] }
    : {}),
  ...(values.proxy ? { proxyEnabled: true } : {}),
  ...(values['no-proxy'] ? { proxyEnabled: false } : {})
};
const requests = [firstUrl, ...additionalUrls].map((url) => ({
  ...commonRequest,
  url
}));
const crawler = new GoogleCrawler();
const result =
  requests.length === 1
    ? await crawler.crawl({ ...commonRequest, url: firstUrl })
    : await crawler.crawlBatch(requests);

console.log(JSON.stringify(result, null, 2));
const failed = Array.isArray(result)
  ? result.some((crawlResult) => !crawlResult.success)
  : !result.success;
if (failed) {
  process.exitCode = 1;
}
