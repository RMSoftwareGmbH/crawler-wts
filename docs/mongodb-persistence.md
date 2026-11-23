# MongoDB review persistence

MongoDB persistence is separate from crawling and is opt-in. Crawlers return
canonical reviews; `ReviewPersistenceService.persist()` validates them and
defaults to dry-run mode. A database write requires `{ persist: true }`.

## Configuration

Copy the safe example when needed:

```powershell
Copy-Item .env.example .env
```

Set `MONGODB_URI` and `MONGODB_DB_NAME` in `.env` or a secret manager. Keep
credentials out of source control and logs. The database URI is required only
when a MongoDB provider is created; fixture tests use no real database.

Optional driver settings and defaults:

| Variable                              | Default | Description                    |
| ------------------------------------- | ------: | ------------------------------ |
| `MONGODB_MAX_POOL_SIZE`               |    `10` | Maximum pooled connections     |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` |  `5000` | Server selection timeout       |
| `MONGODB_CONNECT_TIMEOUT_MS`          | `10000` | TCP connection timeout         |
| `MONGODB_RETRY_WRITES`                |  `true` | Enable driver retryable writes |

The official MongoDB Node.js driver is used. One `MongoClientProvider` reuses a
single connection pool and exposes `ping()` and `close()` for health checks and
graceful shutdown. The connector does not connect to MongoDB unless a caller
explicitly creates the provider/service.

## Review writes and queries

`MongoReviewRepository` creates a unique compound index on
`source`, `externalReviewId`, and `hotel.url`. Upserts use that key, so rerunning
the same crawl does not create duplicate review documents. Bulk writes are
unordered; valid items can succeed even when a different item fails.

Persisted documents retain canonical review data and add `createdAt` and
`updatedAt`. A private `reviewDateAt` field supports date-range queries without
changing the canonical review contract.

Example:

```ts
const provider = new MongoClientProvider();
try {
  const database = await provider.getDb();
  const service = new ReviewPersistenceService(
    new MongoReviewRepository(database),
  );
  const result = await service.persist(crawlResult.reviews, {
    persist: true,
  });
  // Use result.inserted, result.updated, result.skipped, and result.failed.
} finally {
  await provider.close();
}
```

`ReviewPersistenceService.query()` supports filtering by source, hotel URL,
external review ID, date range, and a bounded result limit. No staging database
connection is used by unit tests or claimed as validated here.

Run the local checks with:

```powershell
pnpm test
pnpm build
```
