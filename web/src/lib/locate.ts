// Turning what someone types into Find my rep into a state and district. A street address
// goes only to the U.S. Census Bureau's geocoder. A city or ZIP code (no street) is placed
// with OpenStreetMap's place search, and the Census Bureau names the district at that point.
import { CONGRESS, STATES } from "./format";
import { normalizeName } from "./names";

// The Census vintage whose congressional districts match the Congress being tracked.
const VINTAGES: Record<number, string> = { 119: "ACS2025_Current", 120: "Current_Current" };
const VINTAGE = VINTAGES[CONGRESS] ?? "Current_Current";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies";

export interface Spot {
  state: string;
  district: number | null; // 0 = at-large; null = not found (show the whole state)
  label: string; // what was matched, to show the visitor
}

// "California", "calif", "ca" or "New York" → its two-letter code.
const BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [normalizeName(name), code]));
export function stateFromText(text: string): string | null {
  const t = normalizeName(text);
  if (t.length === 2 && t.toUpperCase() in STATES) return t.toUpperCase();
  return BY_NAME.get(t) ?? BY_NAME.get(t.replace(/^state of /, "")) ?? null;
}

type Geographies = Record<string, Record<string, string>[]>;
function spotFrom(geo: Geographies, label: string): Spot | null {
  const state = geo["States"]?.[0]?.STUSAB;
  if (!state) return null;
  const key = Object.keys(geo).find((k) => /Congressional Districts/.test(k));
  const base = key ? geo[key]?.[0]?.BASENAME : undefined;
  const district = base === undefined ? null : /^\d+$/.test(base) ? Number(base) : 0; // non-numeric = at-large
  return { state, district, label };
}

// A full street address, through the Census Bureau.
export async function fromAddress(address: string): Promise<Spot | null> {
  const url = new URL(`${CENSUS}/onelineaddress`);
  url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", vintage: VINTAGE, format: "json" }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const data = (await res.json()) as { result?: { addressMatches?: { matchedAddress: string; geographies: Geographies }[] } };
  const hit = data.result?.addressMatches?.[0];
  return hit ? spotFrom(hit.geographies, hit.matchedAddress) : null;
}

// A city, town or ZIP code: OpenStreetMap finds its center, the Census Bureau the district there.
// Places don't move, so each answer is kept in Cloudflare's cache for a month: a repeat of a
// common city or ZIP code skips both lookups. (Street addresses are never cached.)
const PLACE_TTL = 30 * 24 * 3600;
export async function fromPlace(place: string): Promise<Spot | null> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`https://checkcongress.com/__place/${encodeURIComponent(normalizeName(place))}?v=${VINTAGE}`);
  const kept = await cache?.match(key).catch(() => undefined);
  if (kept) return (await kept.json()) as Spot | null;
  const spot = await lookUpPlace(place);
  if (spot) {
    const body = new Response(JSON.stringify(spot), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${PLACE_TTL}` } });
    await cache?.put(key, body).catch(() => undefined);
  }
  return spot;
}

async function lookUpPlace(place: string): Promise<Spot | null> {
  const search = new URL("https://nominatim.openstreetmap.org/search");
  search.search = new URLSearchParams({ q: place, countrycodes: "us", format: "jsonv2", limit: "1" }).toString();
  const found = (await (
    await fetch(search, { headers: { "User-Agent": "CheckCongress/1.0 (https://checkcongress.com)" }, signal: AbortSignal.timeout(8_000) })
  ).json()) as { lat: string; lon: string; display_name: string }[];
  const hit = found[0];
  if (!hit) return null;
  const url = new URL(`${CENSUS}/coordinates`);
  url.search = new URLSearchParams({ x: hit.lon, y: hit.lat, benchmark: "Public_AR_Current", vintage: VINTAGE, format: "json" }).toString();
  const data = (await (await fetch(url, { signal: AbortSignal.timeout(12_000) })).json()) as { result?: { geographies?: Geographies } };
  const label = hit.display_name.replace(/, United States$/, "");
  return data.result?.geographies ? spotFrom(data.result.geographies, label) : null;
}

// A house number followed by a street: worth sending to the Census Bureau as an address.
export const looksLikeStreetAddress = (text: string) => /^\s*\d+[a-z]?\s+\S+/i.test(text) && !/^\s*\d{5}(-\d{4})?\s*$/.test(text);
