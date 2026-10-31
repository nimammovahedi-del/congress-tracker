// The console's motion: the page heading decodes from random characters, numbers count up,
// panels unfold on arrival, tabs slide their new view in, and the page dims while the next
// one loads. Everything is skipped for visitors who ask their system for reduced motion.

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// The full arrival sequence (panels unfolding, the heading decoding, numbers counting up)
// plays on the first page of a browser session; later pages arrive with a short, quiet fade.
// The <head> script in Layout.astro decides this before the first paint and marks later
// pages with html.calm.
export const fullArrival = !reducedMotion && !document.documentElement.classList.contains("calm");
// A decoding letter shows random glyphs shaped like it (small letters for small letters,
// capitals for capitals, digits for digits, thin ones for thin ones), so each stand-in is
// about the width of its letter and doesn't run into its neighbours.
const GLYPHS = { thin: "iljtfr1", lower: "abcdeghknopqsuvxyz", upper: "ABCDEFGHKLNOPRSTUXYZ", digit: "0123456789", other: "#%&*+=<>/" };
const randomGlyph = (ch: string) => {
  const set = /[iljtfrI1.,:;'!|]/.test(ch) ? GLYPHS.thin : /[a-z]/.test(ch) ? GLYPHS.lower : /[A-Z]/.test(ch) ? GLYPHS.upper : /\d/.test(ch) ? GLYPHS.digit : GLYPHS.other;
  return set[(Math.random() * set.length) | 0];
};

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

// Decode `text` into `el` from left to right, starting after `delay` ms. Each letter keeps
// its own place, drawn invisibly with a random glyph painted over it (.sc in global.css),
// so the heading never reflows or rewraps while it decodes.
export function scramble(el: HTMLElement, text: string = el.dataset.text ?? el.textContent ?? "", duration = 480, delay = 0): void {
  el.dataset.text = text;
  el.classList.add("decode");
  if (finished || !text.trim()) {
    el.textContent = text;
    return;
  }
  const cells = [...text].map((ch) => {
    const cell = document.createElement("span");
    cell.textContent = ch;
    if (ch.trim()) {
      cell.className = "sc";
      cell.dataset.g = randomGlyph(ch);
    }
    return cell;
  });
  el.replaceChildren(...cells);
  const start = performance.now() + delay;
  let lastShuffle = 0;
  const tick = (now: number) => {
    const p = finished ? 1 : Math.max(0, Math.min(1, (now - start) / duration));
    if (p >= 1) {
      el.textContent = text;
      return;
    }
    const shown = Math.floor(p * cells.length);
    // New glyphs about 20 times a second: fast enough to read as decoding, calm enough not
    // to flicker on every frame.
    const shuffle = now - lastShuffle > 50;
    if (shuffle) lastShuffle = now;
    cells.forEach((cell, i) => {
      if (!cell.className) return;
      if (i < shown) cell.className = "";
      else if (shuffle) cell.dataset.g = randomGlyph(cell.textContent!);
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Count from 0 to the element's data-count value, keeping its decimals and suffix.
export function countUp(el: HTMLElement, duration = 700, delay = 0): void {
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

// Run the arrival effects for everything inside `root` (the whole page by default). Panels
// are numbered for their stagger by the inline script at the end of Layout.astro.
export function boot(root: ParentNode = document): void {
  if (root === document) {
    if (document.hidden) finishAll();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) finishAll();
    });
  }
  if (!fullArrival || finished) return;
  // Only the page's main heading decodes; labels and body text stay still.
  root.querySelectorAll<HTMLElement>("h1 [data-scramble], h1[data-scramble]").forEach((el) => scramble(el, undefined, 460, 60));
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el, i) => countUp(el, 700, 120 + Math.min(i, 6) * 40));
}

// Leaving a page: dim it and run a loading line under the site bar until the next page
// paints. The browser navigates straight away, so nothing waits on the effect.
let leaveTimer = 0;
function leaving(): void {
  const html = document.documentElement;
  html.classList.add("leaving");
  window.clearTimeout(leaveTimer);
  // If no new page arrives (a download, or the visitor pressed Stop), undim after a while.
  leaveTimer = window.setTimeout(() => html.classList.remove("leaving"), 8000);
}
function leave(href: string): void {
  leaving();
  window.location.href = href;
}

// Dim the page for ordinary links to other pages on this site, and for search forms.
export function interceptLinks(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Attributes rather than properties, so the seat chart's SVG links count too.
    const link = (event.target as Element).closest?.("a");
    const href = link?.getAttribute("href");
    if (!link || !href || link.getAttribute("target") || link.hasAttribute("download") || link.hasAttribute("data-instant")) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page / anchors
    leaving();
  });
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (event.defaultPrevented || form.target || new URL(form.action, window.location.href).origin !== window.location.origin) return;
    leaving();
  });
  // Table rows marked with data-href open their record when clicked anywhere.
  document.addEventListener("click", (event) => {
    const row = (event.target as Element).closest?.<HTMLElement>("[data-href]");
    if (!row || (event.target as Element).closest("a, button, input, select")) return;
    leave(new URL(row.dataset.href!, window.location.href).href);
  });
  // Coming back with the browser's Back button can restore the dimmed page from cache.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    window.clearTimeout(leaveTimer);
    document.documentElement.classList.remove("leaving");
  });
}

export function go(href: string): void {
  leave(href);
}

// Tabs: a [data-tabs] box holds tab links (a.tab-link[href="#pane-id"]) and the panes they
// name. Without this script every pane shows and the tabs jump to them; with it, one pane
// shows at a time and slides in from the side of the tab that was picked. The address
// bar's #hash names the open pane, so a link like /bills/119-hr-1#votes opens that tab.
// Boxes may nest (a tab holding tabs). An inline script at the end of Layout.astro already
// hid the closed panes before the first paint, using the same choice as here.
export function initTabs(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-tabs]").forEach((box) => {
    const tabs = [...box.querySelectorAll<HTMLAnchorElement>("a.tab-link")].filter((t) => t.closest("[data-tabs]") === box);
    const panes = tabs.map((t) => document.getElementById(decodeURIComponent(t.hash.slice(1))));
    if (!tabs.length || panes.some((p) => !p)) return;
    box.classList.add("tabs-on");
    tabs[0].parentElement?.setAttribute("role", "tablist");

    // A pane that opens shows its view straight away: panels inside it don't replay their
    // arrival unfold (the pane has its own slide), and its bars, charts and seats fill only
    // the first time it opens.
    const settle = (pane: HTMLElement) => {
      const again = pane.dataset.seen === "1";
      pane.dataset.seen = "1";
      for (const a of pane.getAnimations({ subtree: true })) {
        const effect = a.effect as KeyframeEffect | null;
        if (!effect || effect.target === pane || effect.getComputedTiming().endTime === Infinity) continue;
        if (again || effect.target?.matches(".panel, .panel-frame")) a.finish();
      }
    };

    let open = -1;
    const select = (i: number, animate: boolean) => {
      const dir = i >= open ? 1 : -1;
      open = i;
      tabs.forEach((t, k) => {
        t.setAttribute("aria-selected", String(k === i));
        t.tabIndex = k === i ? 0 : -1;
        panes[k]!.hidden = k !== i;
      });
      const pane = panes[i]!;
      if (!animate || finished) {
        pane.dataset.seen = "1";
        return;
      }
      pane.style.setProperty("--dir", String(dir));
      pane.classList.remove("pane-in");
      void pane.offsetWidth; // restart the animation
      pane.classList.add("pane-in");
      settle(pane);
    };
    const choose = (i: number) => {
      if (i === open) return;
      select(i, true);
      history.replaceState(history.state, "", tabs[i].hash);
    };

    tabs.forEach((t, i) => {
      const pane = panes[i]!;
      t.id ||= `tab-${pane.id}`;
      t.setAttribute("role", "tab");
      t.setAttribute("aria-controls", pane.id);
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute("aria-labelledby", t.id);
      t.addEventListener("click", (event) => {
        event.preventDefault();
        choose(i);
      });
      t.addEventListener("keydown", (event) => {
        const next = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 } as Record<string, number>)[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const n = (next + tabs.length) % tabs.length;
        choose(n);
        tabs[n].focus();
      });
    });

    // Which pane holds the element the #hash names, if any.
    const fromHash = () => {
      const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      return target ? panes.findIndex((p) => p!.contains(target)) : -1;
    };
    const start = fromHash();
    select(start >= 0 ? start : Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true")), false);
    // Hiding the other panes moves the page under the browser's jump to #hash; land on the tabs.
    if (start >= 0) requestAnimationFrame(() => box.scrollIntoView({ block: "start" }));
    window.addEventListener("hashchange", () => {
      const i = fromHash();
      if (i >= 0 && i !== open) select(i, true);
    });
  });
}

// Long text marked [data-clamp="<px>"] shows its first part with a "Show more" button
// (labels from data-more / data-less). Closed tab panes are shown for a moment while the text
// is measured (in the same frame, so nothing flashes).
export function initClamp(root: ParentNode = document): void {
  const closed = [...root.querySelectorAll<HTMLElement>(".tab-pane[hidden]")].filter((pane) => pane.querySelector("[data-clamp]"));
  closed.forEach((pane) => (pane.hidden = false));
  root.querySelectorAll<HTMLElement>("[data-clamp]").forEach((el) => {
    const limit = Number(el.dataset.clamp) || 480;
    if (el.scrollHeight < limit * 1.4) return;
    const more = el.dataset.more ?? "Show more";
    const less = el.dataset.less ?? "Show less";
    el.style.setProperty("--clamp", `${limit}px`);
    el.classList.add("clamped");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn ghost clamp-toggle";
    button.textContent = more;
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const open = !el.classList.toggle("clamped");
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? less : more;
      if (!open) el.scrollIntoView({ block: "nearest" });
    });
    el.parentNode?.insertBefore(button, el.nextSibling);
  });
  closed.forEach((pane) => (pane.hidden = true));
}
