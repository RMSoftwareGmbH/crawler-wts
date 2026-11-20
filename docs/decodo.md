# Decodo proxy configuration

Decodo is used as a configurable proxy layer to improve crawl reliability and
allow controlled proxy locations. It does not guarantee access to every website.

Credentials must be provided through environment variables or a secret manager.
Never commit proxy credentials to the repository.

Recommended environment variables:

- DECODO_PROXY_HOST
- DECODO_PROXY_PORT
- DECODO_PROXY_USERNAME
- DECODO_PROXY_PASSWORD
- DECODO_PROXY_COUNTRY

Set `proxyEnabled` on a crawl request (or pass `--proxy` to the CLI) to use the
proxy. Proxy configuration is strict: enabling it without a host and port
returns a classified failure instead of silently making a direct request.
Country selection is supplied through the Decodo username when the username
contains the `{country}` placeholder; for example, configure
`DECODO_PROXY_USERNAME=user-{country}` and `DECODO_PROXY_COUNTRY=us`. The
connector does not add stealth behavior or bypass access restrictions.
