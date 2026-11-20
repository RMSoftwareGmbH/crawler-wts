import type { CrawlFailureClassification } from '../diagnostics/CrawlDiagnostics.js';

export class CrawlError extends Error {
  constructor(
    readonly classification: CrawlFailureClassification,
    message: string
  ) {
    super(message);
    this.name = 'CrawlError';
  }
}