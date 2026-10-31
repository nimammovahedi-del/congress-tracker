import type { BillType } from "./config.ts";

export function billId(congress: number, type: string, number: number | string): string {
  return `${congress}-${type.toLowerCase()}-${Number(number)}`;
}

const REF = /^(HR|S|HJRES|SJRES|HCONRES|SCONRES|HRES|SRES)(\d+)$/;

// Turn a reference such as 'H R 1' (House Clerk), 'HR1' (Voteview), or 'S. J. Res. 12'
// into a bill id. Returns null for things that aren't bills, like nominations ('PN1129').
export function billIdFromRef(congress: number, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = ref.toUpperCase().replace(/[\s.]/g, "").match(REF);
  return m ? billId(congress, m[1], m[2]) : null;
}

const CONGRESS_GOV_SLUGS: Record<BillType, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
  hres: "house-resolution",
  sres: "senate-resolution",
};

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function congressGovUrl(congress: number, type: BillType, number: number): string {
  return `https://www.congress.gov/bill/${ordinal(congress)}-congress/${CONGRESS_GOV_SLUGS[type]}/${number}`;
}
