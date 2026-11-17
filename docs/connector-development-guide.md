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
