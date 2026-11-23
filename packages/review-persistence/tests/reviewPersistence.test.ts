import { MongoBulkWriteError, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalReviewSchema,
  type CanonicalReview,
} from "../../crawler-contracts/src/index.js";
import {
  loadMongoPersistenceConfig,
  MongoClientProvider,
  MongoReviewRepository,
  ReviewPersistenceError,
  ReviewPersistenceService,
  type MongoClientFactory,
  type MongoPersistenceConfig,
  type ReviewRepository,
} from "../src/index.js";

const review = canonicalReviewSchema.parse({
  source: "google",
  externalReviewId: "review-001",
  hotel: {
    name: "Example Hotel",
    url: "https://www.google.com/maps/place/example-hotel",
  },
  rating: { value: 5, scale: 5 },
  comment: "A sanitized test review.",
  reviewDate: "2026-01-10T00:00:00.000Z",
  sourceMetadata: {
    sourceUrl: "https://www.google.com/maps/place/example-hotel",
    fetchedAt: "2026-01-11T00:00:00.000Z",
    crawlerVersion: "1.0.0",
    schemaVersion: "1.0.0",
  },
});

function config(): MongoPersistenceConfig {
  return loadMongoPersistenceConfig({
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "reviews_test",
  });
}

describe("Mongo persistence configuration", () => {
  it("uses validated safe defaults and configurable driver settings", () => {
    expect(config()).toMatchObject({
      databaseName: "reviews_test",
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 10_000,
      retryWrites: true,
    });
    expect(
      loadMongoPersistenceConfig({
        MONGODB_URI: "mongodb+srv://cluster.example.net",
        MONGODB_DB_NAME: "staging",
        MONGODB_MAX_POOL_SIZE: "15",
        MONGODB_SERVER_SELECTION_TIMEOUT_MS: "7000",
        MONGODB_CONNECT_TIMEOUT_MS: "9000",
        MONGODB_RETRY_WRITES: "false",
      }),
    ).toMatchObject({
      maxPoolSize: 15,
      serverSelectionTimeoutMS: 7_000,
      connectTimeoutMS: 9_000,
      retryWrites: false,
    });
  });

  it("rejects missing or invalid values without echoing the URI", () => {
    const secretUri = "mongodb+srv://user:do-not-print@cluster.example.net";
    expect(() =>
      loadMongoPersistenceConfig({
        MONGODB_URI: secretUri,
        MONGODB_DB_NAME: "staging",
        MONGODB_MAX_POOL_SIZE: "zero",
      }),
    ).toThrow("MONGODB_MAX_POOL_SIZE must be a positive integer.");
    expect(() =>
      loadMongoPersistenceConfig({
        MONGODB_URI: "not-a-mongodb-uri",
        MONGODB_DB_NAME: "staging",
      }),
    ).toThrow("MONGODB_URI must be a valid mongodb:// or mongodb+srv:// URI.");
    expect(() =>
      loadMongoPersistenceConfig({
        MONGODB_URI: secretUri,
      }),
    ).toThrow("MONGODB_DB_NAME is required");
  });
});

describe("MongoClientProvider", () => {
  it("reuses one connection and exposes a ping and clean close", async () => {
    const database = {
      command: vi.fn(async () => ({ ok: 1 })),
    } as unknown as Db;
    const client = {
      connect: vi.fn(async () => undefined),
      db: vi.fn(() => database),
      close: vi.fn(async () => undefined),
    };
    const createClient: MongoClientFactory = () => client;
    const provider = new MongoClientProvider(config(), createClient);

    const [first, second] = await Promise.all([
      provider.getDb(),
      provider.getDb(),
    ]);
    await provider.ping();
    await provider.close();

    expect(first).toBe(database);
    expect(second).toBe(database);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(database.command).toHaveBeenCalledWith({ ping: 1 });
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("sanitizes connection failures and closes the failed client", async () => {
    const client = {
      connect: vi.fn(async () => {
        throw new Error("mongodb://user:private-test-password@host");
      }),
      db: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const provider = new MongoClientProvider(config(), () => client);

    const failure = await provider.getDb().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReviewPersistenceError);
    expect(failure.message).toBe("Could not connect to MongoDB.");
    expect(failure.message).not.toContain("private-test-password");
    expect(client.close).toHaveBeenCalledOnce();
  });
});

describe("MongoReviewRepository", () => {
  it("enforces the unique review key and bulk-upserts unordered", async () => {
    const collection = {
      createIndex: vi.fn(async () => "index"),
      bulkWrite: vi.fn(async () => ({
        upsertedCount: 1,
        matchedCount: 0,
      })),
    };
    const database = {
      collection: vi.fn(() => collection),
    } as unknown as Db;
    const repository = new MongoReviewRepository(database);

    const result = await repository.upsertMany([review, review]);

    expect(result).toEqual({
      inserted: 1,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(collection.createIndex).toHaveBeenCalledWith(
      { source: 1, externalReviewId: 1, "hotel.url": 1 },
      expect.objectContaining({ unique: true }),
    );
    expect(collection.bulkWrite).toHaveBeenCalledWith(
      [expect.objectContaining({ updateOne: expect.any(Object) })],
      { ordered: false },
    );
  });

  it("queries by connector, hotel, review id, and date range", async () => {
    const storedReview = {
      ...review,
      createdAt: new Date("2026-01-11T00:00:00.000Z"),
      updatedAt: new Date("2026-01-11T00:00:00.000Z"),
      reviewDateAt: new Date("2026-01-10T00:00:00.000Z"),
    };
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn(async () => [storedReview]),
    };
    const collection = {
      createIndex: vi.fn(async () => "index"),
      find: vi.fn(() => cursor),
    };
    const database = {
      collection: vi.fn(() => collection),
    } as unknown as Db;
    const repository = new MongoReviewRepository(database);

    const results = await repository.find({
      source: "google",
      hotelUrl: review.hotel.url,
      externalReviewId: review.externalReviewId,
      fromDate: "2026-01-01T00:00:00.000Z",
      toDate: "2026-01-31T23:59:59.999Z",
      limit: 25,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("reviewDateAt");
    expect(collection.find).toHaveBeenCalledWith({
      source: "google",
      "hotel.url": review.hotel.url,
      externalReviewId: review.externalReviewId,
      reviewDateAt: {
        $gte: new Date("2026-01-01T00:00:00.000Z"),
        $lte: new Date("2026-01-31T23:59:59.999Z"),
      },
    });
  });

  it("returns partial bulk success counts without leaking database errors", async () => {
    const collection = {
      createIndex: vi.fn(async () => "index"),
      bulkWrite: vi.fn(async () => {
        throw new MongoBulkWriteError(
          {
            message: "private-test-password",
            code: 11000,
            writeErrors: [{ index: 0, code: 11000, errmsg: "duplicate" }],
          },
          {
            acknowledged: true,
            insertedCount: 0,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            upsertedCount: 0,
            upsertedIds: {},
            insertedIds: {},
          },
        );
      }),
    };
    const database = {
      collection: vi.fn(() => collection),
    } as unknown as Db;
    const repository = new MongoReviewRepository(database);

    const result = await repository.upsert(review);

    expect(result.failed).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private-test-password");
  });
});

describe("ReviewPersistenceService", () => {
  it("defaults to dry-run and never writes unless explicitly enabled", async () => {
    const repository: ReviewRepository = {
      upsert: vi.fn(),
      upsertMany: vi.fn(async () => ({
        inserted: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
      })),
      find: vi.fn(),
    };
    const service = new ReviewPersistenceService(repository);

    const dryRun = await service.persist([review]);
    const persisted = await service.persist([review], { persist: true });

    expect(dryRun).toEqual({
      inserted: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
      dryRun: true,
    });
    expect(repository.upsertMany).toHaveBeenCalledOnce();
    expect(persisted).toMatchObject({ inserted: 1, dryRun: false });
  });

  it("counts invalid reviews and still persists valid items", async () => {
    const repository: ReviewRepository = {
      upsert: vi.fn(),
      upsertMany: vi.fn(async (_reviews: readonly CanonicalReview[]) => ({
        inserted: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
      })),
      find: vi.fn(),
    };
    const service = new ReviewPersistenceService(repository);

    const result = await service.persist([review, { source: "not-a-source" }], {
      persist: true,
    });

    expect(result).toMatchObject({
      inserted: 1,
      failed: 1,
      dryRun: false,
    });
    expect(repository.upsertMany).toHaveBeenCalledWith([review]);
  });
});
