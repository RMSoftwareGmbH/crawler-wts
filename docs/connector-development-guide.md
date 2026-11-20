# Connector development guide

For each connector:

1. Add platform-specific selectors.
2. Add sanitised HTML fixtures.
3. Implement the parser.
4. Implement pagination or load-more behaviour.
5. Implement mapping to canonical review JSON.
6. Add blocked, challenge and consent-page detection.
7. Add unit and integration tests.
8. Verify retries, rate limits, deduplication and diagnostics.

Do not bypass CAPTCHA, authentication, paywalls or other access controls.

The Google connector is the first implemented connector. Run one hotel with
`pnpm tsx scripts/run-connector.ts --connector google --url "<hotel-url>"`, or
pass repeated `--url` options to reuse one Chromium browser across a batch. Each
hotel receives a fresh isolated browser context.
Fixture-driven parser and crawler tests are under
`packages/connectors/google/tests`.

For Google Maps diagnostics, set `GOOGLE_CRAWLER_HEADED=true` to launch a visible browser
and `GOOGLE_CRAWLER_INTERACT=true` to click a visible Reviews/Avis control, expand
normal review text controls, and incrementally scroll the review panel. Interaction
stops on challenge, consent, authentication or blocked pages; it does not bypass
access controls. A screenshot is saved to the operating system's temporary directory
only when `GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT=true`. Review cards and images are
masked in diagnostic screenshots.

Set `GOOGLE_MAX_REVIEWS_PER_RUN=50` to configure the run limit. An explicit
`--max-reviews` CLI value or `maxReviews` request field takes precedence.
Google Maps settles for up to 9 seconds by default, stopping earlier when hotel
content or a Reviews/Avis control is ready. Configure the bound with
`GOOGLE_CRAWLER_SETTLE_MS`. Panel, interaction, and pagination waits use
`GOOGLE_CRAWLER_PANEL_WAIT_MS`,
`GOOGLE_CRAWLER_INTERACTION_WAIT_MS`, and
`GOOGLE_CRAWLER_PAGINATION_WAIT_MS`, respectively.

Experimental request filtering and browser reuse are disabled by default.
Set `GOOGLE_CRAWLER_OPTIMIZE=true` to enable them for controlled testing.
When enabled, filtering only considers non-Google image/media/font resources
and analytics ping requests; document, script, stylesheet, XHR, fetch,
websocket, and Google Maps application requests are allowed.
Set `GOOGLE_CRAWLER_LOCALE` (or the request's `locale`) to configure both the
browser context locale and matching `Accept-Language` header. Selector matching
supports localized Reviews/Avis labels independently of this setting.

Incremental requests may provide `lastSeenReviewId`,
`lastSuccessfulCrawlAt`, and/or `persistedReviewIds` to stop at a known review,
filter reviews older than a successful crawl, and avoid returning already stored
IDs. The CLI accepts these as `--last-seen-review-id`,
`--last-successful-crawl-at`, and repeatable `--persisted-review-id` options.

Google review parsing uses the card's `data-review-id` when available. If absent,
the connector hashes the hotel URL and stable review fields (rating, comment,
author, date, or a public review URL); it never derives an ID from card position.
Cards with a rating and comment are therefore retained even when Google exposes
no public review ID.
