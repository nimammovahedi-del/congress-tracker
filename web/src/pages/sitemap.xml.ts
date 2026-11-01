// The main pages, every topic, and every serving member, for search engines. Bills and votes
// (tens of thousands) are left for crawlers to reach through these pages' links.
import type { APIRoute } from "astro";
import { rows, stat, type Topic } from "../lib/db";

export const GET: APIRoute = async ({ url }) => {
  const [topics, members] = await Promise.all([stat<Topic[]>("topics"), rows<{ bioguide_id: string }>("SELECT bioguide_id FROM members WHERE in_office = 1")]);
  const paths = [
    "/",
    "/topics",
    "/votes",
    "/members",
    "/find",
    "/analytics",
    "/about",
    ...(topics ?? []).map((t) => `/topics/${t.slug}`),
    ...members.map((m) => `/members/${m.bioguide_id}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${url.origin}${p}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
};
