import { readdir } from 'node:fs/promises';

console.log('TODO: Validate connector HTML fixtures.');
console.log(await readdir('packages/connectors', { recursive: true }).catch(() => []));
