# Blocked page runbook

When a page is blocked, challenged or restricted:

1. Record the crawl ID, source, sanitized final URL, page title, navigation status and page classification.
2. Save diagnostics without storing cookies, credentials, tokens or unnecessary personal data.
3. Keep the result unsuccessful for restricted Maps views, challenges, consent pages or authentication pages.
4. To capture a sanitized HTML structure for a failed crawl, explicitly set
   `GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT=true`. The snapshot redacts text and attribute values,
   removes scripts and form controls, and is capped at 50 KB.
5. To capture a viewport screenshot, explicitly set
   `GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT=true`. Review cards and images are masked, and the
   screenshot is written to the operating system's temporary directory.
6. To inspect a single visible review card, explicitly set
   `GOOGLE_CRAWLER_DOM_DIAGNOSTIC=true`. Only that card's sanitized outerHTML is written to
   the operating system's temporary directory; review text, author names, URLs, IDs and
   unknown attribute values are redacted.
7. Apply the configured retry policy and stop after the retry limit.
8. Do not bypass Google restrictions. Escalate selector, access or compliance issues to the team.

For an opt-in visible browser, set `GOOGLE_CRAWLER_HEADED=true`. Set
`GOOGLE_CRAWLER_INTERACT=true` to attempt the normal visible Reviews/Avis control and
bounded review-panel scrolling. This interaction is skipped for challenge, consent,
authentication and blocked pages.
