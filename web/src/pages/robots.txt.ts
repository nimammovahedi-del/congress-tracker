// Lets search engines index the whole site and points them to the sitemap, at whatever
// address the site is served from.
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ url }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
