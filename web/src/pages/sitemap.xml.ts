// The main pages, every topic, every serving member, and every bill and vote on the site, for
// search engines. Bills and votes carry the date they last changed, so crawlers can skip the
// ones they already have: each page they fetch reads from a database with a daily limit.
// (Later pages of the lists are closed to crawlers in robots.txt, so this is how they find
// older bills and votes.)
import type { APIRoute } from "astro";
import { rows, stat, type Topic } from "../lib/db";

export const GET: APIRoute = async ({ url }) => {
  const [topics, members, bills, votes] = await Promise.all([
    stat<Topic[]>("topics"),
    rows<{ bioguide_id: string }>("SELECT bioguide_id FROM members WHERE in_office = 1"),
    rows<{ id: string; d: string | null }>("SELECT id, latest_action_date AS d FROM bills"),
    rows<{ id: string; d: string | null }>("SELECT id, vote_date AS d FROM roll_calls"),
  ]);
  const entries: [string, string | null][] = [
    ...["/", "/topics", "/votes", "/members", "/find", "/states", "/analytics", "/about"].map((p): [string, null] => [p, null]),
    ...(topics ?? []).map((t): [string, null] => [`/topics/${t.slug}`, null]),
    ...members.map((m): [string, null] => [`/members/${m.bioguide_id}`, null]),
    ...bills.map((b): [string, string | null] => [`/bills/${b.id}`, b.d]),
    ...votes.map((v): [string, string | null] => [`/votes/${v.id}`, v.d]),
  ];
  const url_ = (p: string, d: string | null) => `  <url><loc>${url.origin}${p}</loc>${d ? `<lastmod>${d.slice(0, 10)}</lastmod>` : ""}</url>`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(([p, d]) => url_(p, d)).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
};
