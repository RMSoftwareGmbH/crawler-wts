import {
  MongoBulkWriteError,
  type AnyBulkWriteOperation,
  type Collection,
  type Db,
  type Filter,
} from "mongodb";
import {
  canonicalReviewSchema,
  type CanonicalReview,
  type ReviewSource,
} from "../../crawler-contracts/src/index.js";
import { ReviewPersistenceError } from "./errors.js";

export interface PersistedReview extends CanonicalReview {
  createdAt: Date;
  updatedAt: Date;
}

interface MongoReviewDocument extends PersistedReview {
  reviewDateAt?: Date;
}

export interface ReviewQuery {
  source?: ReviewSource;
  hotelUrl?: string;
  externalReviewId?: string;
  fromDate?: string | Date;
  toDate?: string | Date;
  limit?: number;
}

export interface ReviewWriteCounts {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ReviewRepository {
  upsert(review: CanonicalReview): Promise<ReviewWriteCounts>;
  upsertMany(reviews: readonly CanonicalReview[]): Promise<ReviewWriteCounts>;
  find(query: ReviewQuery): Promise<PersistedReview[]>;
}

function dateBound(value: string | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ReviewPersistenceError(
      "validation",
      "Review query date bounds must be valid dates.",
    );
  }
  return date;
}

function documentKey(review: CanonicalReview): string {
  return JSON.stringify([
    review.source,
    review.externalReviewId,
    review.hotel.url,
  ]);
}

function writeErrorCount(error: MongoBulkWriteError): number {
  const errors = Array.isArray(error.writeErrors)
    ? error.writeErrors.length
    : 1;
  return errors + (error.err ? 1 : 0);
}

export class MongoReviewRepository implements ReviewRepository {
  private readonly collection: Collection<MongoReviewDocument>;
  private indexCreation: Promise<void> | undefined;

  constructor(database: Db, collectionName = "reviews") {
    this.collection = database.collection<MongoReviewDocument>(collectionName);
  }

  async upsert(review: CanonicalReview): Promise<ReviewWriteCounts> {
    return this.upsertMany([review]);
  }

  async upsertMany(
    reviews: readonly CanonicalReview[],
  ): Promise<ReviewWriteCounts> {
    const unique = new Map<string, CanonicalReview>();
    for (const review of reviews) {
      const parsed = canonicalReviewSchema.safeParse(review);
      if (!parsed.success) {
        throw new ReviewPersistenceError(
          "validation",
          "MongoDB repository received a non-canonical review.",
        );
      }
      unique.set(documentKey(parsed.data), parsed.data);
    }
    const skipped = reviews.length - unique.size;
    if (unique.size === 0) {
      return { inserted: 0, updated: 0, skipped, failed: 0 };
    }

    await this.ensureIndexes();
    const operations: AnyBulkWriteOperation<MongoReviewDocument>[] = [];
    const now = new Date();
    for (const review of unique.values()) {
      const reviewDateAt = review.reviewDate
        ? new Date(review.reviewDate)
        : undefined;
      operations.push({
        updateOne: {
          filter: {
            source: review.source,
            externalReviewId: review.externalReviewId,
            "hotel.url": review.hotel.url,
          },
          update: {
            $set: {
              ...review,
              updatedAt: now,
              ...(reviewDateAt ? { reviewDateAt } : {}),
            },
            $setOnInsert: { createdAt: now },
            ...(!reviewDateAt ? { $unset: { reviewDateAt: "" } } : {}),
          },
          upsert: true,
        },
      });
    }

    try {
      const result = await this.collection.bulkWrite(operations, {
        ordered: false,
      });
      return {
        inserted: result.upsertedCount,
        updated: result.matchedCount,
        skipped,
        failed: 0,
      };
    } catch (error) {
      if (error instanceof MongoBulkWriteError) {
        return {
          inserted: error.result.upsertedCount,
          updated: error.result.matchedCount,
          skipped,
          failed: writeErrorCount(error),
        };
      }
      throw new ReviewPersistenceError(
        "operation",
        "MongoDB bulk upsert failed.",
      );
    }
  }

  async find(query: ReviewQuery): Promise<PersistedReview[]> {
    const fromDate = dateBound(query.fromDate);
    const toDate = dateBound(query.toDate);
    if (fromDate && toDate && fromDate > toDate) {
      throw new ReviewPersistenceError(
        "validation",
        "Review query fromDate must not be after toDate.",
      );
    }

    const filter: Filter<MongoReviewDocument> = {};
    if (query.source) {
      filter.source = query.source;
    }
    if (query.hotelUrl) {
      filter["hotel.url"] = query.hotelUrl;
    }
    if (query.externalReviewId) {
      filter.externalReviewId = query.externalReviewId;
    }
    if (fromDate || toDate) {
      filter.reviewDateAt = {
        ...(fromDate ? { $gte: fromDate } : {}),
        ...(toDate ? { $lte: toDate } : {}),
      };
    }
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new ReviewPersistenceError(
        "validation",
        "Review query limit must be a positive integer.",
      );
    }

    await this.ensureIndexes();
    try {
      const documents = await this.collection
        .find(filter)
        .sort({ reviewDateAt: -1, updatedAt: -1 })
        .limit(limit)
        .toArray();
      return documents.map(
        ({ reviewDateAt: _reviewDateAt, ...review }) => review,
      );
    } catch {
      throw new ReviewPersistenceError(
        "operation",
        "MongoDB review query failed.",
      );
    }
  }

  private ensureIndexes(): Promise<void> {
    if (!this.indexCreation) {
      this.indexCreation = this.createIndexes();
    }
    return this.indexCreation;
  }

  private async createIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.collection.createIndex(
          { source: 1, externalReviewId: 1, "hotel.url": 1 },
          {
            unique: true,
            name: "uniq_review_source_external_id_hotel_url",
          },
        ),
        this.collection.createIndex(
          { source: 1, "hotel.url": 1, reviewDateAt: -1 },
          { name: "idx_review_source_hotel_date" },
        ),
      ]);
    } catch {
      this.indexCreation = undefined;
      throw new ReviewPersistenceError(
        "operation",
        "MongoDB review indexes could not be created.",
      );
    }
  }
}
