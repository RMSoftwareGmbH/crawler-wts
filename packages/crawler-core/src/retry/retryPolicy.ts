import type { CrawlFailureClassification } from '../diagnostics/CrawlDiagnostics.js';

const retryableFailures = new Set<CrawlFailureClassification>([
  'timeout',
  'network_failure',
  'proxy_failure',
  'navigation_failure'
]);

export function isRetryableFailure(classification: CrawlFailureClassification): boolean {
  return retryableFailures.has(classification);
}