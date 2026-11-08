// Lets search engines index the site and points them to the sitemap, at whatever address
// the site is served from. Filtered views of a list (by subtopic, status, result, session or
// kind of vote) and search results are left out: they repeat pages already indexed, and crawling every
// combination of them used most of the database's free daily reads.
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ url }) =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /search\nDisallow: /*?*subject=\nDisallow: /*?*status=\nDisallow: /*?*votes=\nDisallow: /*?*result=\nDisallow: /*?*session=\nDisallow: /*?*category=\nDisallow: /*?*q=\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
