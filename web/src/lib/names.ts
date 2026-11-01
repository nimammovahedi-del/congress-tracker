// Matching a typed name to members of Congress, forgiving about accents, punctuation, case
// and nicknames: "velazquez" finds Nydia M. Velázquez, and "bernie sanders" finds Bernard
// Sanders through his last name.

export interface Named {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
}

// Lower case, accents dropped, anything that isn't a letter or digit turned into a space.
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Members whose names hold every typed word (as the start of a word); failing that, members
// whose last name is one of the typed words. Single letters ("a" in "Dave A. Min") are skipped.
export function matchMembers<T extends Named>(query: string, members: T[], lastNameFallback = true): T[] {
  const words = normalizeName(query).split(" ").filter((w) => w.length > 1);
  if (!words.length) return [];
  const names = members.map((m) => normalizeName(`${m.full_name} ${m.first_name ?? ""} ${m.last_name ?? ""}`).split(" "));
  const all = members.filter((_, i) => words.every((w) => names[i].some((n) => n.startsWith(w))));
  if (all.length || !lastNameFallback) return all;
  const lastNames = members.map((m) => normalizeName(m.last_name ?? m.full_name.split(" ").pop() ?? ""));
  return members.filter((_, i) => words.some((w) => lastNames[i] === w || lastNames[i].split(" ").includes(w)));
}
