import { z } from 'zod';

export const crawlRequestSchema = z.object({
  url: z.string().url(),
  hotel: z.object({
    externalId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional()
  }).optional(),
  maxPages: z.number().int().positive().optional(),
  maxReviews: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  locale: z.string().trim().min(2).optional(),
  proxyEnabled: z.boolean().optional(),
  lastSeenReviewId: z.string().trim().min(1).optional(),
  lastSuccessfulCrawlAt: z.string().datetime({ offset: true }).optional(),
  persistedReviewIds: z.array(z.string().trim().min(1)).optional()
});