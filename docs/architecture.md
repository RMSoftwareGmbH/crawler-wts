# Crawler WTS architecture

The project contains one connector per supported review platform. Connectors
share the crawler core, browser factory, Decodo proxy provider, retry policy,
normalisation and canonical JSON validation.

Connector-specific selectors and parsing logic must remain isolated inside each
connector package.
