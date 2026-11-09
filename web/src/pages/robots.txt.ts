// Lets search engines index the site and points them to the sitemap, at whatever address
// the site is served from. Every page view reads from a database with a daily limit, so
// crawlers are kept to pages worth indexing:
// - filtered views of a list (by subtopic, status, chamber, result, session or kind of vote)
//   and search results repeat pages already indexed;
// - later pages of a list cost more to read the deeper they go, and a member's voting record
//   past its first page reads their whole record each time (crawling every page of every
//   record cost several days' allowance at once);
// - SEO-tool crawlers bring no visitors, so they are turned away entirely.
// Crawlers that honor Crawl-delay (Bing, Apple, Yandex and others; not Google) are asked to
// space their requests.
import type { APIRoute } from "astro";

const SEO_TOOLS = ["SemrushBot", "AhrefsBot", "MJ12bot", "DotBot", "BLEXBot", "DataForSeoBot", "PetalBot", "serpstatbot", "Barkrowler"];

export const GET: APIRoute = ({ url }) =>
  new Response(
    [
      ...SEO_TOOLS.flatMap((bot) => [`User-agent: ${bot}`, "Disallow: /", ""]),
      "User-agent: *",
      "Allow: /",
      "Disallow: /search",
      // Later pages of a list: their bills, votes and members are linked from elsewhere too.
      "Disallow: /members/*?*page=",
      "Disallow: /topics/*?*page=",
      "Disallow: /votes?*page=",
      ...["subject", "status", "votes", "result", "session", "category", "chamber", "q"].map((p) => `Disallow: /*?*${p}=`),
      "Crawl-delay: 10",
      "",
      `Sitemap: ${url.origin}/sitemap.xml`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } },
  );
