// Talk to the hosted database (Cloudflare D1) through Wrangler, Cloudflare's CLI.
// On a laptop Wrangler uses `wrangler login`; in GitHub Actions it uses the
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./config.ts";

const WRANGLER = path.join(ROOT, "node_modules", ".bin", "wrangler");
const DATABASE = "congress-tracker";

interface D1Result<T> {
  results?: T[];
  meta?: { rows_written?: number; rows_read?: number };
}

function execute<T>(args: string[]): D1Result<T>[] {
  const res = spawnSync(WRANGLER, ["d1", "execute", DATABASE, "--remote", "--json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  const out = res.stdout ?? "";
  // Wrangler may print progress lines before the JSON; the JSON starts on a line that is just "[".
  const start = out.search(/^\[\s*$/m);
  if (res.status !== 0 || start === -1) {
    throw new Error(`wrangler exited with ${res.status}:\n${(res.stderr + out).slice(-3000)}`);
  }
  return JSON.parse(out.slice(start)) as D1Result<T>[];
}

export function d1Query<T>(sql: string): T[] {
  return execute<T>(["--command", sql]).flatMap((r) => r.results ?? []);
}

// Run a file of SQL statements; returns the rows written, as Cloudflare counts them.
export function d1ExecuteFile(file: string): number {
  return execute<unknown>(["--file", file, "--yes"]).reduce((n, r) => n + (r.meta?.rows_written ?? 0), 0);
}
