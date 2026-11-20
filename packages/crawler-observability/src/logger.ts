import pino from 'pino';

export const logger = pino({
  redact: {
    paths: [
      'password',
      'proxy.password',
      'cookies',
      'headers.cookie',
      'headers.authorization',
      '*.password',
      '*.token'
    ],
    censor: '[redacted]'
  }
});