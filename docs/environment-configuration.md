# Runtime environment configuration

The local `.env` file is loaded by the connector CLI and is ignored by Git.
Start from `.env.example`; do not put production credentials in examples,
fixtures, source files, command output, or documentation.

## CLI and persistence modes

Run any supported connector with:

```powershell
pnpm tsx scripts/run-connector.ts --connector google --url "<hotel-url>"
```

The CLI accepts repeated `--url`, and supports `--max-pages`, `--max-reviews`,
`--timeout`, `--locale`, `--proxy`, `--no-proxy`, `--persist`, and `--dry-run`.
Dry-run is the default. It does not create a MongoDB client. The CLI only
connects to MongoDB when `--persist` is explicitly supplied; `--persist` and
`--dry-run` cannot be used together. Google batch crawling remains available
when repeated URLs are supplied; the other connectors run those URLs
sequentially.

## MongoDB

MongoDB values are required only with `--persist`:

| Variable                              | Required             | Default | Description                                                                                   |
| ------------------------------------- | -------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                         | Yes, for `--persist` | None    | `mongodb://` or `mongodb+srv://` connection URI. Store it only in `.env` or a secret manager. |
| `MONGODB_DB_NAME`                     | Yes, for `--persist` | None    | Database name.                                                                                |
| `MONGODB_MAX_POOL_SIZE`               | No                   | `10`    | Maximum client connection pool size.                                                          |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | No                   | `5000`  | Server selection timeout.                                                                     |
| `MONGODB_CONNECT_TIMEOUT_MS`          | No                   | `10000` | Connection timeout.                                                                           |
| `MONGODB_RETRY_WRITES`                | No                   | `true`  | MongoDB retryable writes setting.                                                             |

Settings are validated before connection. Review persistence upserts on
`source`, `externalReviewId`, and `hotel.url`; dry-run is the default of the
persistence service as well. See [MongoDB persistence](./mongodb-persistence.md).

## Decodo proxy

| Variable                | Required                     | Default | Description                                                              |
| ----------------------- | ---------------------------- | ------- | ------------------------------------------------------------------------ |
| `DECODO_PROXY_ENABLED`  | No                           | `false` | Use the configured proxy unless overridden by `--proxy` or `--no-proxy`. |
| `DECODO_PROXY_HOST`     | When proxying                | None    | Proxy host name.                                                         |
| `DECODO_PROXY_PORT`     | When proxying                | None    | Proxy port from 1 through 65535.                                         |
| `DECODO_PROXY_USERNAME` | No                           | None    | Optional proxy username; may contain `{country}`.                        |
| `DECODO_PROXY_PASSWORD` | No                           | None    | Optional proxy password.                                                 |
| `DECODO_PROXY_COUNTRY`  | If username uses `{country}` | None    | Two-letter country code substituted in the username template.            |

Proxy credentials are not logged. Enabling proxying without a valid host and
port returns a classified configuration failure. See
[Decodo proxy configuration](./decodo.md).

## Google Maps

Google-specific settings are validated when the Google connector is selected.
Boolean values must be `true` or `false`; integer settings must be positive
unless identified as a wait (waits may be zero).

| Variable                               | Default  | Description                                                          |
| -------------------------------------- | -------- | -------------------------------------------------------------------- |
| `GOOGLE_MAX_REVIEWS_PER_RUN`           | `50`     | Default review cap; request or CLI `--max-reviews` takes precedence. |
| `GOOGLE_CRAWLER_SETTLE_MS`             | `9000`   | Maximum Maps page settle wait.                                       |
| `GOOGLE_CRAWLER_PANEL_WAIT_MS`         | `5000`   | Wait for the reviews panel.                                          |
| `GOOGLE_CRAWLER_INTERACTION_WAIT_MS`   | `1000`   | Wait after normal review interactions.                               |
| `GOOGLE_CRAWLER_PAGINATION_WAIT_MS`    | `1000`   | Wait between pagination/scroll actions.                              |
| `GOOGLE_CRAWLER_OPTIMIZE`              | `false`  | Experimental request filtering and browser reuse.                    |
| `GOOGLE_CRAWLER_LOCALE`                | `en-US`  | Browser and Maps interface locale.                                   |
| `GOOGLE_CRAWLER_HEADED`                | `false`  | Launch a visible browser for diagnostics.                            |
| `GOOGLE_CRAWLER_INTERACT`              | `false`  | Enable normal public Reviews/Avis interaction.                       |
| `GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT` | `false`  | Opt into a masked diagnostic screenshot.                             |
| `GOOGLE_CRAWLER_DOM_DIAGNOSTIC`        | `false`  | Opt into a sanitized first-review-card diagnostic.                   |
| `GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT`   | `false`  | Opt into the connector's DOM snapshot diagnostic.                    |
| `GOOGLE_CRAWLER_ALLOW_LEGACY_SCROLL`   | `false`  | Allow the legacy scroll adapter for debugging.                       |
| `GOOGLE_MAX_SCROLL_ATTEMPTS`           | `50`     | Maximum review-panel scroll steps.                                   |
| `GOOGLE_REVIEW_SCROLL_WAIT_MS`         | `1000`   | Wait for newly loaded cards after a scroll.                          |
| `GOOGLE_NO_PROGRESS_LIMIT`             | `3`      | Consecutive scrolls tolerated without new review IDs.                |
| `GOOGLE_CRAWL_TIMEOUT_MS`              | `120000` | Total review scrolling time budget.                                  |

The optional `liveScrollDiagnostic.ts` helper also reads
`GOOGLE_DIAG_URL` (unset), `GOOGLE_DIAG_HEADLESS` (`false`), and
`GOOGLE_DIAG_PAUSE_MS` (`3000`).

The Google connector does not bypass CAPTCHA, authentication, or access
controls. Optimization remains opt-in.

## Environment validation and Git safety

The CLI validates proxy enablement and proxy host/port when proxying is
requested, Google-specific settings when Google is selected, and MongoDB
settings before an explicitly requested persistent crawl. Validation errors
are sanitized and do not echo connection strings or passwords.

Verify the local environment file is ignored with:

```powershell
git check-ignore -v .env
```

The tracked `.env.example` contains placeholders and non-secret defaults only.
