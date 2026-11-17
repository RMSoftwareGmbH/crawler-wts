import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    connector: { type: 'string' },
    url: { type: 'string' }
  }
});

if (!values.connector || !values.url) {
  console.error('Usage: pnpm tsx scripts/run-connector.ts --connector google --url <hotel-url>');
  process.exit(1);
}

console.log(`TODO: run connector '${values.connector}' for ${values.url}`);
