// One address for the site: visits to the old workers.dev address or to www are sent, with
// their path and query, to https://checkcongress.com.
//
// Pages are also kept in Cloudflare's cache. Every visitor sees the same page (there are no
// accounts or cookies) and the data changes only a few times a day, so a page is reused for
// six hours, and a repeat view costs no database reads. Each copy is kept for a week: if the
// database can't answer (for example, past the free plan's daily read limit), visitors get
// the last good copy of the page instead of an error.
import { defineMiddleware } from "astro:middleware";

export const SITE_ORIGIN = "https://checkcongress.com";
const FRESH_MS = 6 * 3600 * 1000;
const KEEP_SECONDS = 7 * 24 * 3600;
const FRESH_UNTIL = "X-Fresh-Until";
// Cached as well as pages: the sitemap lists every bill and vote, so it's costly to build.
const CACHED_TYPES = /^(text\/html|application\/xml)/;

// The cache key: the page's address without tags that links add for tracking (?utm_source=…,
// ?fbclid=…) or a redundant ?page=1, and with what's left in a fixed order, so the same page
// reached by different links is built once.
function cacheKey(url: URL): Request {
  const key = new URL(url.pathname, url.origin);
  const params = [...url.searchParams].filter(([k, v]) => !/^(utm_|fbclid$|gclid$|msclkid$|ref$)/.test(k) && !(k === "page" && v === "1"));
  for (const [k, v] of params.sort(([a], [b]) => a.localeCompare(b))) key.searchParams.append(k, v);
  return new Request(key.href);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { hostname, pathname, search } = context.url;
  if (hostname.endsWith(".workers.dev") || hostname === "www.checkcongress.com") {
    return context.redirect(`${SITE_ORIGIN}${pathname}${search}`, 301);
  }
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const method = context.request.method;
  if (!cache || (method !== "GET" && method !== "HEAD")) return next();

  const key = cacheKey(context.url);
  const kept = await cache.match(key).catch(() => undefined);
  // Cloudflare's copy is kept for a week; browsers check back each time.
  const serve = (copy: Response) => {
    const out = new Response(method === "HEAD" ? null : copy.body, copy);
    out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    out.headers.delete(FRESH_UNTIL);
    return out;
  };
  if (kept && Number(kept.headers.get(FRESH_UNTIL)) > Date.now()) return serve(kept);

  let response: Response;
  try {
    response = await next();
  } catch (error) {
    if (kept) return serve(kept);
    throw error;
  }
  if (response.status >= 500 && kept) return serve(kept);
  if (method === "GET" && response.status === 200 && CACHED_TYPES.test(response.headers.get("Content-Type") ?? "")) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set("Cache-Control", `public, max-age=${KEEP_SECONDS}`);
    copy.headers.set(FRESH_UNTIL, String(Date.now() + FRESH_MS));
    await cache.put(key, copy).catch(() => undefined);
  }
  return response;
});
