export function retryDelayMs(retryNumber: number, baseDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, retryNumber - 1), 10_000);
}