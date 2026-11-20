import type { z } from 'zod';
import type { canonicalReviewSchema } from './canonicalReview.schema.js';

export type CanonicalReview = z.infer<typeof canonicalReviewSchema>;