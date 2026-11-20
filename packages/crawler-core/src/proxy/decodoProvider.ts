import { CrawlError } from '../crawler/CrawlError.js';

export interface DecodoEnvironment {
  DECODO_PROXY_HOST?: string;
  DECODO_PROXY_PORT?: string;
  DECODO_PROXY_USERNAME?: string;
  DECODO_PROXY_PASSWORD?: string;
  DECODO_PROXY_COUNTRY?: string;
}

export interface ProxyConfiguration {
  server: string;
  username?: string;
  password?: string;
}

export function createDecodoProxyConfiguration(
  environment: DecodoEnvironment
): ProxyConfiguration {
  const host = environment.DECODO_PROXY_HOST?.trim();
  const port = environment.DECODO_PROXY_PORT?.trim();
  if (!host || !port) {
    throw new CrawlError('proxy_failure', 'Decodo proxy host and port must be configured when proxying is enabled.');
  }
  if (!/^[a-z0-9.-]+$/i.test(host) || !/^\d{1,5}$/.test(port) || Number(port) > 65535) {
    throw new CrawlError('proxy_failure', 'Decodo proxy host or port is invalid.');
  }

  const country = environment.DECODO_PROXY_COUNTRY?.trim().toLowerCase();
  const rawUsername = environment.DECODO_PROXY_USERNAME;
  const username = rawUsername?.replace('{country}', country ? `country-${country}` : '');
  if (rawUsername?.includes('{country}') && !country) {
    throw new CrawlError('proxy_failure', 'DECODO_PROXY_COUNTRY is required by the configured username template.');
  }

  return {
    server: `http://${host}:${port}`,
    ...(username ? { username } : {}),
    ...(environment.DECODO_PROXY_PASSWORD ? { password: environment.DECODO_PROXY_PASSWORD } : {})
  };
}