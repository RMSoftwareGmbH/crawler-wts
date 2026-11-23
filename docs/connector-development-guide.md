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

For CLI flags, persistence modes, environment variables, and local secret
handling, see [runtime environment configuration](./environment-configuration.md).

The Google connector is the first implemented connector. Run one hotel with
`pnpm tsx scripts/run-connector.ts --connector google --url "<hotel-url>"`, or
pass repeated `--url` options to reuse one Chromium browser across a batch. Each
hotel receives a fresh isolated browser context.
Fixture-driven parser and crawler tests are under
`packages/connectors/google/tests`.

For Google Maps diagnostics, set `GOOGLE_CRAWLER_HEADED=true` to launch a visible browser
and `GOOGLE_CRAWLER_INTERACT=true` to click a visible Reviews/Avis control, expand
normal review text controls, restore original review text when a visible
translation toggle is available, and incrementally scroll the review panel. It
also opens a visible full-reviews control when available. Interaction stops on
challenge, consent, authentication or blocked pages; it does not bypass access
controls. A screenshot is saved to the operating system's temporary directory
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
browser context locale, matching `Accept-Language` header, and the Maps `hl`
interface-language parameter. Selector matching supports localized Reviews/Avis
labels independently of this setting. The locale controls Google Maps'
interface language, not the language of review content;
the crawler clicks a visible original-text toggle when Google provides one. If
there is no such control, it preserves the review text Google displays.

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

The Tripadvisor connector accepts public hotel review URLs matching the
`Hotel_Review` path, paginates through visible load-more controls, and stops on
the configured `maxReviews` (default 100), `maxPages` (default 10), or when a
page adds no new review cards. It retries retryable failures once by default
and uses a one-second pagination wait. Callers can provide `locale` and
`proxyEnabled`; `DECODO_PROXY_ENABLED` and the optional Decodo host, port,
username, password, and country settings are documented in
[`decodo.md`](./decodo.md). Tripadvisor protection, consent, and authentication
pages are reported as failures; the connector does not attempt to bypass them.
Fixture-driven parser and crawler tests are under
`packages/connectors/tripadvisor/tests`.

The Booking connector accepts hotel pages under `booking.com/hotel/...`, opens
the visible, localized Guest Reviews control, and parses cards only from the
visible review panel. Pagination is scoped to that panel. It stops at the
request's `maxReviews` (default 100) or `maxPages` (default 10), on a page with
no new review IDs, or when there is no next-page control. Booking's ten-point
scores are normalized to the canonical five-point scale. Public review IDs are
preferred; otherwise a deterministic hash of the hotel URL and stable review
fields is used, never a card index. A panel that explicitly reports no reviews
is a `no_reviews_available` failure; an opened panel without recognizable
review cards is a `selector_drift` failure. Challenge, consent, authentication,
and blocked pages are failures; the connector does not bypass them.
Fixture-driven tests are under `packages/connectors/booking/tests`.

The Expedia connector accepts public Expedia hotel-detail URLs, parses visible
review cards, and follows visible next-page controls. It stops at `maxReviews`
(default 100), `maxPages` (default 10), or when pagination makes no progress.
Expedia scores on a ten-point scale are normalized to the canonical five-point
scale. The parser prefers public review IDs and otherwise hashes the hotel URL
and stable review fields; IDs never depend on card position. Incremental
requests can use `lastSeenReviewId`, `lastSuccessfulCrawlAt`, and
`persistedReviewIds`. Challenge, consent, authentication, and blocked pages
fail explicitly without access-control circumvention. Fixture-driven tests are
under `packages/connectors/expedia/tests`.

The HolidayCheck connector accepts public `holidaycheck.de` hotel pages under
the `/hi/` or `/hotel/` paths. It parses visible review cards, normalizes the
site's six-point rating scale to the canonical five-point scale, and follows
visible pagination controls. It stops at `maxReviews` (default 100), `maxPages`
(default 10), or when a page produces no new review IDs. Explicit IDs are
preferred; otherwise the connector hashes the hotel URL and stable review
fields, never the card position. Incremental requests can provide
`lastSeenReviewId`, `lastSuccessfulCrawlAt`, and `persistedReviewIds`.
Challenge, consent, authentication, and blocked pages fail explicitly and are
not bypassed. Fixture-driven tests are under
`packages/connectors/holidaycheck/tests`.

The Hotels.com connector accepts public `hotels.com` hotel URLs using hotel
IDs (`/ho...`) or hotel-detail paths. It parses visible review cards, converts
ten-point scores to the canonical five-point scale, and follows visible
pagination controls up to `maxPages` (default 10) and `maxReviews` (default
100). It deduplicates by public review ID or a deterministic hash of the hotel
URL and stable review fields, never by card position, and supports incremental
requests with `lastSeenReviewId`, `lastSuccessfulCrawlAt`, and
`persistedReviewIds`. Challenge, consent, authentication, and blocked pages
fail explicitly without access-control circumvention. Fixture-driven tests are
under `packages/connectors/hotels-com/tests`.
