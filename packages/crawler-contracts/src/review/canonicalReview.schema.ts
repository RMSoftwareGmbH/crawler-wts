import { z } from 'zod';
import { reviewSources } from '../source/sourceType.js';

const optionalNonEmptyString = z.string().trim().min(1).optional();

export const canonicalReviewSchema = z.object({
  source: z.enum(reviewSources),
  externalReviewId: z.string().trim().min(1),
  hotel: z.object({
    externalId: optionalNonEmptyString,
    name: optionalNonEmptyString,
    address: optionalNonEmptyString,
    url: z.string().url()
  }),
  rating: z.object({
    value: z.number().finite().min(0).max(5),
    scale: z.number().finite().positive().max(5)
  }),
  title: optionalNonEmptyString,
  comment: optionalNonEmptyString,
  author: z.object({
    displayName: optionalNonEmptyString,
    profileUrl: z.string().url().optional()
  }).optional(),
  reviewDate: z.string().datetime({ offset: true }).optional(),
  language: optionalNonEmptyString,
  businessReply: z.object({
    text: optionalNonEmptyString,
    publishedAt: z.string().datetime({ offset: true }).optional()
  }).optional(),
  sourceMetadata: z.object({
    sourceUrl: z.string().url(),
    fetchedAt: z.string().datetime({ offset: true }),
    crawlerVersion: z.string().min(1),
    schemaVersion: z.string().min(1)
  })
});