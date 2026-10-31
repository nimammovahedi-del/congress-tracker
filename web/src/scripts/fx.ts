// The console's motion: text that decodes from random characters, numbers that count up,
// panels that unfold on arrival and fold away before the next page loads.
// Everything is skipped for visitors who ask their system for reduced motion.

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/_";
const randomGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

// Set when effects should stop and everything should show its final state, e.g. when the
// tab is hidden (browsers pause animation frames there, which would freeze text mid-scramble).
let finished = reducedMotion;

function formatCount(el: HTMLElement, n: number): string {
  const decimals = Number(el.dataset.decimals ?? 0);
  return (
    (el.dataset.prefix ?? "") +
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) +
    (el.dataset.suffix ?? "")
  );
}

export function finishAll(): void {
  finished = true;
  document.documentElement.classList.remove("fx");
  document.querySelectorAll<HTMLElement>("[data-scramble]").forEach((el) => {
    if (el.dataset.text !== undefined) el.textContent = el.dataset.text;
  });
  document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const n = Number(el.dataset.count);
    if (Number.isFinite(n)) el.textContent = formatCount(el, n);
  });
}

// Decode `text` into `el` from left to right, starting after `delay` ms.
export function scramble(el: HTMLElement, text: string = el.dataset.text ?? el.textContent ?? "", duration = 650, delay = 0): void {
  el.dataset.text = text;
  if (finished || !text) {
    el.textContent = text;
    return;
  }
  const start = performance.now() + delay;
  const tick = (now: number) => {
    if (finished) {
      el.textContent = text;
      return;
    }
    const p = Math.max(0, Math.min(1, (now - start) / duration));
    const shown = Math.floor(p * text.length);
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      out += ch === " " || i < shown ? ch : randomGlyph();
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Turn `el` into random characters (used when leaving a page).
function garble(el: HTMLElement): void {
  const text = el.textContent ?? "";
  el.textContent = [...text].map((ch) => (ch === " " ? ch : randomGlyph())).join("");
}

// Count from 0 to the element's data-count value, keeping its decimals and suffix.
export function countUp(el: HTMLElement, duration = 1000, delay = 0): void {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;
  const format = (n: number) => formatCount(el, n);
  if (finished) {
    el.textContent = format(target);
    return;
  }
  const start = performance.now() + delay;
  const tick = (now: number) => {
    if (finished) {
      el.textContent = format(target);
      return;
    }
    const p = Math.max(0, Math.min(1, (now - start) / duration));
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Run the arrival effects for everything inside `root` (the whole page by default).
export function boot(root: ParentNode = document): void {
  if (root === document) {
    if (document.hidden) finishAll();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) finishAll();
    });
  }
  root.querySelectorAll<HTMLElement>(".panel").forEach((panel, i) => panel.style.setProperty("--i", String(Math.min(i, 8))));
  root.querySelectorAll<HTMLElement>("[data-scramble]").forEach((el, i) => scramble(el, undefined, 600, 120 + Math.min(i, 12) * 45));
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el, i) => countUp(el, 1100, 150 + Math.min(i, 8) * 60));
}

// Fold the page away, then go to `href`.
function leave(href: string): void {
  if (finished) {
    window.location.href = href;
    return;
  }
  document.documentElement.classList.add("leaving");
  document.querySelectorAll<HTMLElement>("[data-scramble], [data-count], h1").forEach((el) => {
    if (el.children.length === 0) garble(el);
  });
  window.setTimeout(() => (window.location.href = href), 230);
}

// Use the fold-away transition for ordinary links to other pages on this site.
export function interceptLinks(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest?.("a");
    if (!link || link.target || link.hasAttribute("download") || link.dataset.instant !== undefined) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page / anchors
    event.preventDefault();
    leave(url.href);
  });
  // Table rows marked with data-href open their record when clicked anywhere.
  document.addEventListener("click", (event) => {
    const row = (event.target as Element).closest?.<HTMLElement>("[data-href]");
    if (!row || (event.target as Element).closest("a, button, input, select")) return;
    leave(new URL(row.dataset.href!, window.location.href).href);
  });
  // Coming back with the browser's Back button can restore the folded page from cache.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) document.documentElement.classList.remove("leaving");
  });
}

export function go(href: string): void {
  leave(href);
}
