/* Small DOM helpers shared by the AOI scanner and the content script. */
import type { ElementRef } from "@cm/shared";

/** FNV-1a 32-bit -> base36, short and stable. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Minimal CSS.escape (jsdom lacks it). */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  const body = value.replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
  const m = /^(-?)(\d)/.exec(body);
  return m ? `${m[1]}\\3${m[2]} ${body.slice(m[0].length)}` : body;
}

/** Classes that look generated (CSS-in-JS hashes, state classes) are poor selector anchors. */
function usableClass(c: string): boolean {
  return (
    c.length > 1 &&
    c.length < 40 &&
    !/^(css|sc|jsx|emotion|svelte)-/.test(c) &&
    !/[0-9a-f]{6,}/i.test(c) &&
    !/^(is|has)-(active|hover|focus|open|selected)/.test(c) &&
    !c.startsWith("cm-")
  );
}

function usableId(id: string): boolean {
  return !!id && id.length < 50 && !/\d{3,}|[0-9a-f]{8,}|^:|^(ember|react|radix)/i.test(id);
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let s = tag;
  const classes = Array.from(el.classList).filter(usableClass).slice(0, 2);
  if (classes.length) s += classes.map((c) => "." + cssEscape(c)).join("");
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return s;
}

function isUnique(doc: Document, sel: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(sel);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** Short, unique-ish CSS selector (max 5 levels, anchored at an id or a data-product-id when available). */
export function cssSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (usableId(el.id)) {
    const s = "#" + cssEscape(el.id);
    if (isUnique(doc, s, el)) return s;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur === doc.documentElement) {
      parts.unshift("html");
      break;
    }
    if (depth > 0 && usableId(cur.id)) {
      parts.unshift("#" + cssEscape(cur.id));
      break;
    }
    const pid = cur.getAttribute("data-product-id");
    let seg = segment(cur);
    if (pid && depth > 0) seg = `${cur.tagName.toLowerCase()}[data-product-id="${pid.replace(/"/g, '\\"')}"]`;
    parts.unshift(seg);
    const sel = parts.join(" > ");
    if (isUnique(doc, sel, el)) return sel;
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

const INTERACTIVE_SEL = 'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[onclick],[tabindex]:not([tabindex="-1"])';
const FORM_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "OPTION"]);

export function isInteractive(el: Element): boolean {
  if (el.closest(INTERACTIVE_SEL)) return true;
  try {
    const view = el.ownerDocument.defaultView;
    return !!view && view.getComputedStyle(el).cursor === "pointer";
  } catch {
    return false;
  }
}

/** Trimmed visible text; never form-field values. */
export function safeText(el: Element, max = 200): string | undefined {
  if (FORM_TAGS.has(el.tagName) || el.closest("select,textarea")) return undefined;
  if ((el as HTMLElement).isContentEditable) return undefined;
  let text = "";
  const walk = (n: Node): void => {
    if (text.length > max * 2) return;
    if (n.nodeType === 3) text += n.nodeValue ?? "";
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (FORM_TAGS.has(e.tagName) || e.tagName === "SCRIPT" || e.tagName === "STYLE" || e.tagName === "NOSCRIPT") return;
      if ((e as HTMLElement).isContentEditable) return;
      text += " ";
      e.childNodes.forEach(walk);
    }
  };
  walk(el);
  const t = text.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

export function elementRef(el: Element, aoiId?: string): ElementRef {
  const ref: ElementRef = {
    selector: cssSelector(el),
    tag: el.tagName.toLowerCase(),
    interactive: isInteractive(el),
  };
  const text = safeText(el);
  if (text) ref.text = text;
  if (aoiId) ref.aoiId = aoiId;
  return ref;
}
