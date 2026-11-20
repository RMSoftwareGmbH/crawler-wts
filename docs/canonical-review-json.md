# Canonical review JSON

All connectors must map platform-specific data to the shared Zod-validated
canonical review contract before the result is persisted or sent to another
service.

The contract requires a source, stable external review ID, hotel URL, rating
value and scale, source URL, fetch time, crawler version and schema version.
Optional information is represented only when publicly available:

- title
- comment or review text
- public author
- review date
- language
- visible business reply
- source URL and crawler metadata

Review dates and fetch times use ISO 8601. Ratings use a numeric value and an
explicit scale. Empty strings are omitted. Validate each result at runtime
before returning it from a connector.

Google review IDs prefer the visible stable review ID, then a public review
permalink. If neither is available, the connector hashes the hotel URL and
stable review fields; this fallback is deterministic but can change if those
fields are edited.
