/* Review page: inspect a recorded session, remove context entries, upload or delete; manage uploaded sessions. */
import type { Aoi, ContextEntry, Fixation, PageVisit } from "@cm/shared";
import { deleteUploadedSession, uploadSession } from "../lib/api";
import { deleteSessionData, getSessionMeta, listSessionMetas, loadSession, putSessionMeta, type StoredSession } from "../lib/idb";
import type { DeviceInfo, UploadedSessionInfo } from "../lib/messages";
import { getLocal, setLocal } from "../lib/storage";
import { buildSessionUpload, computeOutcome } from "../lib/upload";
import { $, bg, CATEGORY_LABELS, fmtDuration, fmtTime, gradeFor, h } from "./common";

const app = $("#app");
const params = new URLSearchParams(location.search);
const sessionId = params.get("id");

const OUTCOME_LABEL: Record<string, string> = {
  purchase: "Purchase",
  checkout: "Reached checkout",
  cart: "Added to cart",
  browse: "Browsed",
};

function device(): DeviceInfo {
  return { screenW: screen.width, screenH: screen.height, dpr: devicePixelRatio || 1, userAgent: navigator.userAgent };
}

// ------------------------------------------------------------------ session view

async function renderSession(id: string, flash?: { tone: string; text: string }): Promise<void> {
  const s = await loadSession(id);
  if (!s) {
    app.replaceChildren(
      h("div.card", null, h("h2", null, "Session not found"), h("p.muted", null, "It may have been uploaded or deleted already.")),
      await uploadedCard(),
    );
    return;
  }
  const { meta } = s;
  document.title = `Review ${meta.shopName} session – Cookie Monster`;
  const recording = meta.status === "recording";
  const end = meta.endedAt ?? Date.now();
  const outcome = computeOutcome(s.events);
  const clicks = s.events.filter((e) => e.kind === "click").length;

  const uploadBtn = h("button.btn", { disabled: recording }, "Upload to study");
  const deleteBtn = h("button.btn.danger", { disabled: recording }, "Delete");
  const msg = h("div.alert", { hidden: !flash, class: `alert ${flash?.tone ?? ""}` }, flash?.text ?? "");

  uploadBtn.addEventListener("click", async () => {
    uploadBtn.disabled = true;
    deleteBtn.disabled = true;
    uploadBtn.textContent = "Uploading…";
    msg.hidden = true;
    try {
      const cfg = await getLocal("config");
      if (!cfg) throw new Error("This extension is not connected to a study server.");
      const fresh = await loadSession(id);
      if (!fresh) throw new Error("Session data is gone.");
      const built = buildSessionUpload(fresh, device());
      if (!built.ok || !built.payload) throw new Error("The session data is not valid: " + built.errors.join("; "));
      const res = await uploadSession(cfg.serverUrl, cfg.token, built.payload);
      const info: UploadedSessionInfo = {
        id: res?.id ?? fresh.meta.id,
        shopId: fresh.meta.shopId,
        shopName: fresh.meta.shopName,
        startedAt: fresh.meta.startedAt,
        endedAt: built.payload.endedAt,
        uploadedAt: Date.now(),
        serverUrl: cfg.serverUrl,
        pages: built.payload.pages.length,
        fixations: built.payload.fixations.length,
      };
      await bg({ type: "session_uploaded", info });
      await deleteSessionData(id);
      await renderUploaded(info);
    } catch (e) {
      msg.className = "alert bad";
      msg.textContent = `Upload failed: ${(e as Error).message}`;
      msg.hidden = false;
      uploadBtn.disabled = false;
      deleteBtn.disabled = false;
      uploadBtn.textContent = "Retry upload";
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!confirm("Delete this session from this computer? It will not be uploaded.")) return;
    await deleteSessionData(id);
    app.replaceChildren(
      h("div.card.done-hero", null, h("div.big", null, "🗑"), h("h1", null, "Session deleted"), h("p.muted", null, "Nothing from it was uploaded.")),
      await localSessionsCard(),
      await uploadedCard(),
    );
  });

  app.replaceChildren(
    h(
      "div.page-head",
      null,
      h(
        "div",
        null,
        h("h1", null, `Your session on ${meta.shopName}`),
        h("div.muted", null, `${fmtTime(meta.startedAt)} · ${fmtDuration(end - meta.startedAt)}${recording ? " · still recording" : ""}`),
      ),
      h("div.actions", null, deleteBtn, uploadBtn),
    ),
    msg,
    recording ? h("div.alert.warn", null, "This session is still recording. Stop it from the extension popup before uploading.") : "",
    h(
      "p.muted",
      { style: "margin:4px 0 0" },
      "Check what will be shared. Remove anything from the pre-shop activity you do not want to share, then upload – or delete the session.",
    ),
    h(
      "div.stats",
      null,
      stat(fmtDuration(end - meta.startedAt - meta.pausedMs), "active time"),
      stat(String(s.pages.length), "pages visited"),
      stat(String(s.fixations.length), "fixations"),
      stat(String(clicks), "clicks"),
      stat(OUTCOME_LABEL[outcome], "outcome"),
      meta.gazeSource === "mouse"
        ? stat("Mouse", "debug gaze source")
        : meta.calibration
          ? stat(`${meta.calibration.meanErrorDeg.toFixed(1)}°`, `calibration · ${gradeFor(meta.calibration.meanErrorDeg).label}`)
          : stat("–", "no calibration"),
    ),
    contextCard(s, id),
    pagesCard(s),
    h(
      "div.card",
      null,
      h("h2", null, "What gets uploaded"),
      h(
        "p.small.muted",
        { style: "margin:0" },
        `Gaze points (${s.gaze.length}), fixations, clicks/scrolls, the masked page recording (${s.rrweb.reduce((a, r) => a + r.events.length, 0)} DOM events) for each page above, the AOI layout, the pre-shop activity list, and your screen size/browser version. No camera images, no typed text.`,
      ),
    ),
    await uploadedCard(),
  );
}

function stat(v: string, label: string): HTMLElement {
  return h("div.stat", null, h("b", null, v), h("span", null, label));
}

function contextCard(s: StoredSession, id: string): HTMLElement {
  const entries = s.meta.context;
  const body = entries.length
    ? h(
        "table.ctx",
        null,
        ...entries.map((e, i) =>
          h(
            "tr",
            null,
            h("td.when", null, new Date(e.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })),
            h("td", null, h("span.chip.accent", null, CATEGORY_LABELS[e.category] ?? e.category)),
            h("td.what", null, describe(e)),
            h("td.when", null, fmtDuration(e.endedAt - e.startedAt)),
            h(
              "td.act",
              null,
              h(
                "button.btn.ghost.small",
                {
                  title: "Remove this entry",
                  onclick: async () => {
                    const meta = await getSessionMeta(id);
                    if (!meta) return;
                    meta.context = meta.context.filter((_, j) => j !== i);
                    await putSessionMeta(meta);
                    await renderSession(id, { tone: "good", text: "Entry removed. It will not be uploaded." });
                  },
                },
                "Remove",
              ),
            ),
          ),
        ),
      )
    : h("div.empty", null, "No activity before the shop was recorded.");
  return h(
    "section.card",
    null,
    h("h2", null, "Before the shop", h("span.chip", null, `${entries.length}`)),
    h("p.small.muted", { style: "margin:0 0 8px" }, "Your activity in the 30 minutes before the session, as categories."),
    body,
  );
}

function describe(e: ContextEntry): Node {
  const parts: Node[] = [h("b", null, e.domain)];
  if (e.title) parts.push(document.createTextNode(` · ${e.title}`));
  if (e.query) parts.push(document.createTextNode(` · “${e.query}”`));
  return h("span", null, ...parts);
}

function pagesCard(s: StoredSession): HTMLElement {
  const byPage = new Map<string, Fixation[]>();
  for (const f of s.fixations) byPage.set(f.pageId, [...(byPage.get(f.pageId) ?? []), f]);
  const aoisBy = new Map<string, Aoi[]>();
  for (const a of s.aois) aoisBy.set(a.pageId, [...(aoisBy.get(a.pageId) ?? []), a]);
  return h(
    "section.card",
    null,
    h("h2", null, "Pages & where you looked", h("span.chip", null, `${s.pages.length}`)),
    s.pages.length
      ? h(
          "div.pages",
          null,
          ...s.pages.map((p) =>
            h(
              "div.page-card",
              null,
              h("div.tpl", null, p.urlTemplate),
              h("div.ttl", { title: p.url }, p.title || p.url),
              gazePathSvg(p, byPage.get(p.id) ?? [], aoisBy.get(p.id) ?? []),
              h("div.small.muted", null, `${fmtDuration(p.endedAt - p.startedAt)} · ${(byPage.get(p.id) ?? []).length} fixations`),
            ),
          ),
        )
      : h("div.empty", null, "No pages recorded."),
  );
}

/** Small SVG: page outline, AOI boxes, fixation circles (size ~ duration) connected in order. */
export function gazePathSvg(p: PageVisit, fixations: Fixation[], aois: Aoi[]): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const W = 260;
  const docW = Math.max(p.docSize.w, p.viewport.w, 1);
  const docH = Math.max(p.docSize.h, p.viewport.h, 1);
  const k = W / docW;
  // limit very long pages: show down to the deepest fixation (+ one viewport), max 3x width
  const deepest = Math.max(p.viewport.h, ...fixations.map((f) => f.y + 100));
  const shownH = Math.min(docH, Math.max(p.viewport.h, deepest), docW * 3);
  const H = Math.max(60, Math.round(shownH * k));
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const add = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const el = document.createElementNS(ns, tag);
    for (const [a, v] of Object.entries(attrs)) el.setAttribute(a, String(v));
    parent.append(el);
    return el;
  };
  // first viewport (above the fold)
  add("rect", { x: 0, y: 0, width: W, height: Math.min(H, p.viewport.h * k), fill: "rgba(59,71,196,.05)" });
  add("line", { x1: 0, y1: p.viewport.h * k, x2: W, y2: p.viewport.h * k, stroke: "rgba(59,71,196,.35)", "stroke-dasharray": "4 3" });
  for (const a of aois) {
    add("rect", {
      x: a.rect.x * k,
      y: a.rect.y * k,
      width: Math.max(1, a.rect.w * k),
      height: Math.max(1, a.rect.h * k),
      fill: "none",
      stroke: a.kind === "price" ? "rgba(245,158,11,.6)" : a.kind === "cta" ? "rgba(34,197,94,.6)" : "rgba(127,127,140,.35)",
      "stroke-width": 0.8,
    });
  }
  if (fixations.length > 1) {
    add("polyline", {
      points: fixations.map((f) => `${(f.x * k).toFixed(1)},${(f.y * k).toFixed(1)}`).join(" "),
      fill: "none",
      stroke: "rgba(198,47,37,.45)",
      "stroke-width": 1,
    });
  }
  for (const f of fixations) {
    const c = add("circle", {
      cx: (f.x * k).toFixed(1),
      cy: (f.y * k).toFixed(1),
      r: Math.min(10, 1.5 + f.duration / 120).toFixed(1),
      fill: "rgba(198,47,37,.35)",
      stroke: "rgba(198,47,37,.8)",
      "stroke-width": 0.6,
    });
    const t = document.createElementNS(ns, "title");
    t.textContent = `${Math.round(f.duration)} ms${f.target?.aoiId ? ` · ${f.target.aoiId}` : ""}`;
    c.append(t);
  }
  return svg;
}

async function renderUploaded(info: UploadedSessionInfo): Promise<void> {
  app.replaceChildren(
    h(
      "div.card.done-hero",
      null,
      h("div.big", null, "✅"),
      h("h1", null, "Thank you – your session was uploaded"),
      h(
        "p.muted",
        null,
        `${info.pages} pages and ${info.fixations} fixations were shared with the ${info.shopName} study. The local copy was removed. You can still delete it from the server below.`,
      ),
    ),
    await localSessionsCard(),
    await uploadedCard(),
  );
}

// ------------------------------------------------------------------ lists

async function localSessionsCard(): Promise<HTMLElement> {
  const metas = await listSessionMetas();
  return h(
    "section.card.list",
    null,
    h("h2", null, "On this computer", h("span.chip", null, String(metas.length))),
    ...(metas.length
      ? metas.map((m) =>
          h(
            "div.item",
            null,
            h(
              "div.grow",
              null,
              h("b", null, m.shopName),
              h("div.small.muted", null, `${fmtTime(m.startedAt)} · ${fmtDuration((m.endedAt ?? Date.now()) - m.startedAt)}${m.status === "recording" ? " · recording" : " · not uploaded yet"}`),
            ),
            h("a.btn.secondary", { href: `review.html?id=${m.id}` }, "Review"),
          ),
        )
      : [h("div.empty", null, "No local sessions waiting for review.")]),
  );
}

async function uploadedCard(): Promise<HTMLElement> {
  const list = await getLocal("uploaded");
  const cfg = await getLocal("config");
  const card = h(
    "section.card.list",
    null,
    h("h2", null, "My uploaded sessions", h("span.chip", null, String(list.length))),
  );
  if (!list.length) {
    card.append(h("div.empty", null, "Nothing uploaded yet."));
    return card;
  }
  for (const u of list) {
    const del = h("button.btn.secondary", null, "Delete from server");
    const row = h(
      "div.item",
      null,
      h(
        "div.grow",
        null,
        h("b", null, u.shopName),
        h("div.small.muted", null, `${fmtTime(u.startedAt)} · ${fmtDuration(u.endedAt - u.startedAt)} · uploaded ${fmtTime(u.uploadedAt)}`),
      ),
      del,
    );
    del.addEventListener("click", async () => {
      if (!confirm("Delete this session from the study server? This cannot be undone.")) return;
      del.disabled = true;
      del.textContent = "Deleting…";
      try {
        if (!cfg) throw new Error("Not connected to a study server.");
        await deleteUploadedSession(u.serverUrl || cfg.serverUrl, cfg.token, u.id);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 404) {
          del.disabled = false;
          del.textContent = "Delete from server";
          alert(`Could not delete: ${(e as Error).message}`);
          return;
        }
      }
      const cur = await getLocal("uploaded");
      await setLocal(
        "uploaded",
        cur.filter((x) => x.id !== u.id),
      );
      row.remove();
    });
    card.append(row);
  }
  return card;
}

async function renderIndex(): Promise<void> {
  document.title = "My sessions – Cookie Monster";
  app.replaceChildren(
    h("div.page-head", null, h("div", null, h("h1", null, "Your study sessions"), h("div.muted", null, "Review, upload or delete what you recorded."))),
    await localSessionsCard(),
    await uploadedCard(),
  );
}

void (sessionId ? renderSession(sessionId) : renderIndex()).catch((e: Error) => {
  app.replaceChildren(h("div.alert.bad", null, `Could not load: ${e.message}`));
});
