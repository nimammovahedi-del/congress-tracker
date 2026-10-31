import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, "data", "congress.db");

// The Congress being tracked. The 119th ends on 2027-01-03; set CONGRESS=120 after that.
export const CONGRESS = Number(process.env.CONGRESS ?? 119);

export const USER_AGENT = "congress-tracker/0.1 (free civic data project)";

export const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;
export type BillType = (typeof BILL_TYPES)[number];

// A Congress starts on January 3 of an odd year and has two sessions, one per year.
export function congressYears(congress: number): { session: number; year: number }[] {
  const first = 1789 + (congress - 1) * 2;
  return [
    { session: 1, year: first },
    { session: 2, year: first + 1 },
  ];
}

export function congressDates(congress: number): { start: string; end: string } {
  const first = 1789 + (congress - 1) * 2;
  return { start: `${first}-01-03`, end: `${first + 2}-01-03` };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return nowIso().slice(0, 10);
}
