// Display helpers shared by every page.

export const SITE_NAME = "Congress Tracker"; // working name
export const CONGRESS = 119;

const BILL_TYPE_LABELS: Record<string, string> = {
  hr: "H.R.",
  s: "S.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hconres: "H.Con.Res.",
  sconres: "S.Con.Res.",
  hres: "H.Res.",
  sres: "S.Res.",
};

export function billNumber(type: string, number: number | string): string {
  return `${BILL_TYPE_LABELS[type] ?? type.toUpperCase()} ${number}`;
}

export function billNumberFromId(id: string): string {
  const [, type, number] = id.split("-");
  return billNumber(type, number);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dates are stored as 'YYYY-MM-DD'; format them without time-zone shifts.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// '2 hours ago', '29 days ago': how long since something happened, in words.
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "a while ago";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// 'Sep 16, 2026' — the date as shown in lists and tables. (It used to be uppercased; mixed
// case is easier to read, and labels that want capitals get them from CSS.)
export function consoleDate(iso: string | null | undefined): string {
  return formatDate(iso);
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : n.toLocaleString("en-US");
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${formatNumber(n)} ${n === 1 ? word : many}`;
}

export type Tone = "neutral" | "info" | "progress" | "good" | "bad";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  introduced: { label: "Introduced", tone: "neutral" },
  reported: { label: "Reported by committee", tone: "info" },
  passed_house: { label: "Passed House", tone: "progress" },
  passed_senate: { label: "Passed Senate", tone: "progress" },
  passed_both: { label: "Passed Congress", tone: "progress" },
  presented: { label: "Sent to President", tone: "progress" },
  vetoed: { label: "Vetoed", tone: "bad" },
  became_law: { label: "Became law", tone: "good" },
  agreed: { label: "Agreed to", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
};

// Color for a vote result such as "Passed", "Motion Rejected", or "Not Agreed to".
export function resultTone(result: string | null | undefined): string {
  if (!result) return "";
  if (/fail|reject|\bnot\b|defeat/i.test(result)) return "tone-bad";
  if (/pass|agree|confirm|adopt|sustain/i.test(result)) return "tone-good";
  return "";
}

export const PARTY: Record<string, { name: string; plural: string; letter: string }> = {
  D: { name: "Democrat", plural: "Democrats", letter: "D" },
  R: { name: "Republican", plural: "Republicans", letter: "R" },
  I: { name: "Independent", plural: "Independents", letter: "I" },
};

export function partyClass(party: string | null | undefined): string {
  return party === "D" ? "dem" : party === "R" ? "rep" : "ind";
}

// How a member voted, in plain words ("yea" and "nay" are the chambers' own terms).
export const POSITION_LABELS: Record<string, string> = {
  yea: "Yes",
  nay: "No",
  present: "Present",
  not_voting: "Didn't vote",
  other: "Other",
};

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico", GU: "Guam",
  VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

// 'D-VT' for senators, 'D-NC-12' for representatives ('AL' for at-large seats).
export function memberTag(m: { party?: string | null; state?: string | null; district?: number | null; chamber?: string | null }): string {
  const base = `${m.party ?? "?"}-${m.state ?? "?"}`;
  if (m.chamber !== "house" || m.district === null || m.district === undefined) return base;
  return `${base}-${m.district === 0 ? "AL" : m.district}`;
}

// 'Hank Johnson Jr.' -> 'Johnson': the surname shown in compact lists, skipping suffixes.
export function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  while (parts.length > 1 && /^(jr|sr|i{2,3}|iv|v)\.?,?$/i.test(parts.at(-1)!)) parts.pop();
  return (parts.at(-1) ?? full).replace(/,$/, "");
}

export function memberTitle(chamber: string | null | undefined): string {
  return chamber === "senate" ? "Sen." : "Rep.";
}

// Must match slugify() in the data pipeline (src/sources/stats.ts).
export function slugify(name: string): string {
  return name.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Official text is linked as XML in the source data (in an /xml/ or newer /uslm/ folder);
// people want the HTML or PDF version, which GovInfo keeps alongside it.
export function textLinks(xmlUrl: string | null): { html: string; pdf: string } | null {
  const folder = xmlUrl?.match(/\/(xml|uslm)\//)?.[0];
  if (!xmlUrl || !folder) return null;
  return {
    html: xmlUrl.replace(folder, "/html/").replace(/\.xml$/, ".htm"),
    pdf: xmlUrl.replace(folder, "/pdf/").replace(/\.xml$/, ".pdf"),
  };
}

// CRS summaries arrive as HTML. Keep only basic formatting tags, with no attributes.
const ALLOWED_TAGS = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "h3", "h4"]);
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-zA-Z0-9]+)\b[^>]*>/g, (tag, name: string) => {
      const lower = name.toLowerCase();
      if (!ALLOWED_TAGS.has(lower)) return "";
      return tag.startsWith("</") ? `</${lower}>` : `<${lower}>`;
    });
}
