// Seat positions for a semicircle chart of a chamber, like a parliament diagram.
// Seats sit on concentric arcs; outer arcs hold more seats. Positions come back sorted
// left to right, so filling them in order gives each party a wedge.

export interface Seat {
  x: number;
  y: number;
}

export function hemicycle(n: number): { seats: Seat[]; dot: number } {
  if (n <= 0) return { seats: [], dot: 0 };
  const rows = Math.max(3, Math.round(Math.sqrt(n / 3.5)));
  const inner = 38;
  const outer = 100;
  const radii = Array.from({ length: rows }, (_, i) => inner + ((outer - inner) * i) / (rows - 1));
  const total = radii.reduce((a, b) => a + b, 0);

  // Seats per arc in proportion to its length; leftovers go to the outer arcs.
  const counts = radii.map((r) => Math.floor((n * r) / total));
  let left = n - counts.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; left > 0; i = (i - 1 + rows) % rows) {
    counts[i]++;
    left--;
  }

  const placed: (Seat & { angle: number; r: number })[] = [];
  radii.forEach((r, i) => {
    const k = counts[i];
    for (let j = 0; j < k; j++) {
      const angle = k === 1 ? Math.PI / 2 : Math.PI * (1 - j / (k - 1));
      placed.push({ x: r * Math.cos(angle), y: -r * Math.sin(angle), angle, r });
    }
  });
  placed.sort((a, b) => b.angle - a.angle || a.r - b.r);

  const radial = (outer - inner) / (rows - 1);
  const arc = Math.min(...radii.map((r, i) => (counts[i] > 1 ? (Math.PI * r) / (counts[i] - 1) : Infinity)));
  return { seats: placed.map(({ x, y }) => ({ x, y })), dot: 0.34 * Math.min(radial, arc) };
}
