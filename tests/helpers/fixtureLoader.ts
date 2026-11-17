import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadFixture(relativePath: string): Promise<string> {
  return readFile(resolve(process.cwd(), relativePath), 'utf8');
}
