// One address for the site: visits to the old workers.dev address or to www are sent, with
// their path and query, to https://checkcongress.com.
//
// Pages are also kept in Cloudflare's cache for six hours. Every visitor sees the same page
// (there are no accounts or cookies) and the data changes only a few times a day, so a
// repeat view of a page costs no database reads. That keeps the site well inside the free
// plan's 5 million rows read a day, however many people (or search engines) visit.
import { defineMiddleware } from "astro:middleware";

export const SITE_ORIGIN = "https://checkcongress.com";
const PAGE_TTL = 6 * 3600;

export const onRequest = defineMiddleware(async (context, next) => {
  const { hostname, pathname, search } = context.url;
  if (hostname.endsWith(".workers.dev") || hostname === "www.checkcongress.com") {
    return context.redirect(`${SITE_ORIGIN}${pathname}${search}`, 301);
  }
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache || context.request.method !== "GET") return next();

  const key = new Request(context.url.href);
  const kept = await cache.match(key).catch(() => undefined);
  if (kept) {
    // The six hours apply to Cloudflare's copy only; browsers check back each time.
    const hit = new Response(kept.body, kept);
    hit.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return hit;
  }
  const response = await next();
  if (response.status === 200 && (response.headers.get("Content-Type") ?? "").includes("text/html")) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set("Cache-Control", `public, max-age=${PAGE_TTL}`);
    await cache.put(key, copy).catch(() => undefined);
  }
  return response;
});
