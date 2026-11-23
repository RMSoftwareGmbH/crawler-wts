import {
  canonicalReviewSchema,
  type CanonicalReview,
} from "../../crawler-contracts/src/index.js";
import {
  MongoReviewRepository,
  type PersistedReview,
  type ReviewQuery,
  type ReviewRepository,
  type ReviewWriteCounts,
} from "./reviewRepository.js";
import { MongoClientProvider } from "./mongoClientProvider.js";
import { ReviewPersistenceError } from "./errors.js";

export interface PersistReviewsOptions {
  persist?: boolean;
}

export interface ReviewPersistenceResult extends ReviewWriteCounts {
  dryRun: boolean;
}

export class ReviewPersistenceService {
  constructor(private readonly repository?: ReviewRepository) {}

  static async connect(provider = new MongoClientProvider()): Promise<{
    service: ReviewPersistenceService;
    close: () => Promise<void>;
    ping: () => Promise<void>;
  }> {
    const database = await provider.getDb();
    return {
      service: new ReviewPersistenceService(
        new MongoReviewRepository(database),
      ),
      close: () => provider.close(),
      ping: () => provider.ping(),
    };
  }

  async persist(
    reviews: readonly unknown[],
    options: PersistReviewsOptions = {},
  ): Promise<ReviewPersistenceResult> {
    const validReviews: CanonicalReview[] = [];
    let failed = 0;
    for (const review of reviews) {
      const parsed = canonicalReviewSchema.safeParse(review);
      if (parsed.success) {
        validReviews.push(parsed.data);
      } else {
        failed += 1;
      }
    }

    if (options.persist !== true) {
      return {
        inserted: 0,
        updated: 0,
        skipped: validReviews.length,
        failed,
        dryRun: true,
      };
    }
    if (validReviews.length === 0) {
      return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed,
        dryRun: false,
      };
    }

    if (!this.repository) {
      throw new ReviewPersistenceError(
        "configuration",
        "A MongoDB repository is required when persistence is enabled.",
      );
    }
    const result = await this.repository.upsertMany(validReviews);
    return { ...result, failed: result.failed + failed, dryRun: false };
  }

  query(query: ReviewQuery): Promise<PersistedReview[]> {
    if (!this.repository) {
      throw new ReviewPersistenceError(
        "configuration",
        "A MongoDB repository is required to query persisted reviews.",
      );
    }
    return this.repository.find(query);
  }
}
