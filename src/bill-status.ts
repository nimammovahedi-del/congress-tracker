// How far a bill has progressed, derived from its actions.
//
// Congress.gov tags key actions with numeric Library of Congress action codes.
// The codes used here were checked against the 119th Congress data (see README).
export type BillStatus =
  | "introduced"
  | "reported"        // a committee reported it
  | "passed_house"
  | "passed_senate"
  | "passed_both"     // passed both chambers, not yet sent to the President
  | "agreed"          // resolution adopted; resolutions don't go to the President
  | "presented"       // sent to the President
  | "vetoed"
  | "became_law"
  | "failed";

export interface ActionLike {
  action_date: string;
  action_code: string | null;
  text: string;
}

const CODES = {
  reportedOriginalHouse: "1010", // a House committee reported its own new bill
  reportedHouse: "5000",
  passedHouse: "8000",
  failedHouse: "9000",
  reportedSenate: "14000",
  passedSenate: "17000",
  failedSenate: "18000",
  presented: "28000",
  vetoed: "31000",
  becameLaw: "36000",
} as const;

export function deriveStatus(
  billType: string,
  actions: ActionLike[],
  hasLaw: boolean,
): { status: BillStatus; date: string | null } {
  // Latest date each code appears on.
  const dates = new Map<string, string>();
  for (const a of actions) {
    if (!a.action_code) continue;
    const prev = dates.get(a.action_code);
    if (!prev || a.action_date > prev) dates.set(a.action_code, a.action_date);
  }
  const at = (code: string) => dates.get(code) ?? null;
  const latest = (...codes: string[]) => codes.map(at).filter((d): d is string => !!d).sort().at(-1) ?? null;

  const lawAction = actions.find((a) => /^Became (Public|Private) Law/i.test(a.text));
  if (hasLaw || at(CODES.becameLaw) || lawAction) {
    return { status: "became_law", date: at(CODES.becameLaw) ?? lawAction?.action_date ?? null };
  }

  const vetoDate = at(CODES.vetoed);
  if (vetoDate) return { status: "vetoed", date: vetoDate };
  if (at(CODES.presented)) return { status: "presented", date: at(CODES.presented) };

  const house = at(CODES.passedHouse);
  const senate = at(CODES.passedSenate);
  const simpleResolution = billType === "hres" || billType === "sres";
  const resolution = simpleResolution || billType === "hconres" || billType === "sconres";

  if (simpleResolution && (house || senate)) return { status: "agreed", date: house ?? senate };
  if (house && senate) {
    return { status: resolution ? "agreed" : "passed_both", date: latest(CODES.passedHouse, CODES.passedSenate) };
  }
  if (house) return { status: "passed_house", date: house };
  if (senate) return { status: "passed_senate", date: senate };
  if (at(CODES.failedHouse) || at(CODES.failedSenate)) {
    return { status: "failed", date: latest(CODES.failedHouse, CODES.failedSenate) };
  }
  const reported = latest(CODES.reportedOriginalHouse, CODES.reportedHouse, CODES.reportedSenate);
  if (reported) return { status: "reported", date: reported };
  return { status: "introduced", date: actions[0]?.action_date ?? null };
}

// Pick the name people know a bill by: a popular title, else a short title for the
// whole bill, else the official title. Short titles "for portions of this bill" are
// skipped; they name only one piece of a larger bill.
export function pickTitle(titles: { type: string; title: string }[], fallback: string): string {
  const usable = titles.filter((t) => t.title && !/portions/i.test(t.type));
  const popular = usable.find((t) => t.type.startsWith("Popular Title"));
  const enacted = usable.find((t) => t.type.startsWith("Short Title") && /Enacted/i.test(t.type));
  const short = usable.find((t) => t.type.startsWith("Short Title"));
  return (popular ?? enacted ?? short)?.title ?? fallback;
}
