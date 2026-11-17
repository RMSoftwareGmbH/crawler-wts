# Canonical review JSON

All connectors must map platform-specific data to the shared canonical review
contract before the result is persisted or sent to another service.

The contract should include, when available:

- source and external review ID
- hotel identity
- rating and rating scale
- title
- comment or review text
- public author
- review date
- language
- visible business reply
- source URL and crawler metadata

Validate the result at runtime before returning it from a connector.
