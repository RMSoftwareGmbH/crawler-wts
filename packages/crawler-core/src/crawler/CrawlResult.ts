import type { CanonicalReview } from '../../../crawler-contracts/src/review/canonicalReview.js';
import type { CrawlDiagnostics } from '../diagnostics/CrawlDiagnostics.js';

export interface CrawlResult {
  success: boolean;
  reviews: CanonicalReview[];
  diagnostics: CrawlDiagnostics;
}