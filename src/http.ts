import { USER_AGENT } from "./config.ts";

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true; // network errors and timeouts
}

// GET a URL, retrying network errors, rate limits, and server errors with backoff.
async function get(url: string, accept?: string, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return res;
      await res.body?.cancel();
      throw new HttpError(res.status, url);
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastError = err;
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

export async function getText(url: string): Promise<string> {
  return (await get(url)).text();
}

export async function getJson<T>(url: string): Promise<T> {
  return (await (await get(url, "application/json")).json()) as T;
}

export async function getBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await get(url)).arrayBuffer());
}

// Run `fn` over `items` with at most `limit` running at once, keeping result order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
