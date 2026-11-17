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
