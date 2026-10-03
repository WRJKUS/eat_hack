/* Popup: setup -> consent -> main (session control, helper status, calibration, settings). */
import type { PopupState } from "../lib/messages";
import { STUDY_CONFIG } from "../lib/study-config";
import { consentBody } from "./consent";
import { $, bg, calibrationSummary, fmtAgo, fmtClock, fmtDuration, gradeFor, h } from "./common";

const app = $("#app");
const chip = $("#status-chip");
let state: PopupState | null = null;
let renderedSig = "";
let busy = false;
let flash: { tone: "bad" | "good" | "warn"; text: string } | null = null;

async function refresh(force = false): Promise<void> {
  const r = await bg<PopupState>({ type: "get_state" });
  if (!r.ok) {
    app.replaceChildren(h("div.alert.bad", null, r.error ?? "Background not reachable."));
    return;
  }
  state = r;
  const sig = signature(r);
  if (force || sig !== renderedSig) {
    renderedSig = sig;
    render();
  }
  tickTimers();
}

/** Re-render only on meaningful changes (keeps form focus, avoids flicker). */
function signature(s: PopupState): string {
  const view = viewOf(s);
  if (view === "setup") return "setup";
  return JSON.stringify([
    view,
    s.consent?.at,
    s.calibration?.at,
    s.settings,
    s.session && [s.session.id, s.session.paused, s.session.gazeSource],
    s.pendingReview.map((p) => p.id),
    s.activeTab?.shop?.id,
    s.activeTab?.url,
    s.helper.connected,
    s.helper.error,
    s.helper.status && [
      s.helper.status.cameras,
      s.helper.status.calibrated,
      s.helper.status.faceDetected,
      Math.round(s.helper.status.fps),
      s.helper.status.streaming,
    ],
    s.contextEntries,
    flash,
    s.config?.fetchedAt,
  ]);
}

function viewOf(s: PopupState): "setup" | "consent" | "main" {
  if (!s.config) return "setup";
  if (!s.consent) return "consent";
  return "main";
}

function setChip(): void {
  const s = state!;
  chip.className = "chip";
  if (s.session) {
    if (s.session.paused) {
      chip.classList.add("warn");
      chip.textContent = "❚❚ Paused";
    } else {
      chip.classList.add("rec");
      chip.textContent = "● REC";
    }
  } else if (!s.config || !s.consent) {
    chip.textContent = "Setup";
  } else {
    chip.classList.add("good");
    chip.textContent = "Ready";
  }
}

function render(): void {
  const s = state!;
  setChip();
  const view = viewOf(s);
  const nodes: Node[] = [];
  if (flash) nodes.push(h("div.alert", { class: `alert ${flash.tone}` }, flash.text));
  if (view === "setup") nodes.push(setupView());
  else if (view === "consent") nodes.push(consentView());
  else nodes.push(...mainView());
  app.replaceChildren(...nodes);
  if (view !== "setup" && s.config) {
    app.append(h("footer.foot", null, `Tester ${s.config.testerConfig.testerId} · ${s.config.serverUrl}`));
  }
}

function tickTimers(): void {
  const s = state;
  if (!s?.session) return;
  const el = document.getElementById("session-timer");
  if (el) {
    const pausedMs = s.session.pausedMs + (s.session.paused && s.session.pausedAt ? Date.now() - s.session.pausedAt : 0);
    el.textContent = fmtClock(Date.now() - s.session.startedAt - pausedMs);
  }
}

async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.style.cursor = "progress";
  try {
    const r = await fn();
    flash = r.ok ? (okText ? { tone: "good", text: okText } : null) : { tone: "bad", text: r.error ?? "Something went wrong." };
  } catch (e) {
    flash = { tone: "bad", text: (e as Error).message };
  } finally {
    busy = false;
    document.body.style.cursor = "";
    await refresh(true);
  }
}

// ------------------------------------------------------------------ setup

function setupView(): HTMLElement {
  const server = h("input", { type: "url", value: STUDY_CONFIG.serverUrl, required: true, spellcheck: false });
  const token = h("input", { type: "text", value: STUDY_CONFIG.inviteToken, placeholder: "e.g. demo-tester-token", autocomplete: "off", spellcheck: false });
  const err = h("div.alert.bad", { hidden: true });
  const btn = h("button.btn.block", { type: "submit" }, "Connect");
  const form = h(
    "form.card",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = "Connecting…";
        const r = await bg({ type: "set_config", serverUrl: server.value, token: token.value });
        btn.disabled = false;
        btn.textContent = "Connect";
        if (!r.ok) {
          err.textContent = r.error ?? "Could not connect.";
          err.hidden = false;
          return;
        }
        flash = null;
        await refresh(true);
      },
    },
    h("h2", null, "Join a study"),
    h("p.muted.small", { style: "margin:0 0 12px" }, "Enter the study server and the invite code you received from the research team."),
    h("label.field", null, h("span", null, "Study server"), server),
    h("label.field", null, h("span", null, "Invite code"), token),
    err,
    btn,
  );
  setTimeout(() => token.focus(), 50);
  return form;
}

// ------------------------------------------------------------------ consent

function consentView(): HTMLElement {
  const s = state!;
  const cfg = s.config!;
  const check = h("input", { type: "checkbox" });
  const go = h("button.btn.block", { disabled: true }, "I agree – continue");
  check.addEventListener("change", () => (go.disabled = !check.checked));
  go.addEventListener("click", () => act(() => bg({ type: "give_consent" }), "Thanks! You can now calibrate and start."));
  return h(
    "section.card.consent",
    null,
    ...consentBody(cfg.testerConfig),
    h("label.agree", null, check, h("span", null, "I have read this and explicitly agree to take part. I can withdraw at any time.")),
    go,
    h(
      "div",
      { style: "text-align:center;margin-top:8px" },
      h("button.btn.ghost.small", { onclick: () => act(() => bg({ type: "reset_all" })) }, "Use a different invite"),
    ),
  );
}

// ------------------------------------------------------------------ main

function mainView(): Node[] {
  return [sessionCard(), helperCard(), ...pendingCard(), settingsCard()];
}

function sessionCard(): HTMLElement {
  const s = state!;
  const sess = s.session;
  if (sess) {
    return h(
      "section.card",
      null,
      h("h2", null, "Study session"),
      h(
        "div.session-live",
        null,
        h("span", { class: sess.paused ? "dot warn" : "dot rec" }),
        h("div", null, h("div.shop", null, sess.shopName), h("div.muted.small", null, sess.paused ? "Paused – nothing is recorded" : "Recording")),
        h("div.spacer"),
        h("div.timer#session-timer", null, "00:00"),
      ),
      sess.gazeSource === "mouse"
        ? h("div.alert.warn", { style: "margin-top:10px" }, "Debug mode: the mouse pointer is used as gaze.")
        : null,
      h(
        "div.actions",
        null,
        sess.paused
          ? h("button.btn", { onclick: () => act(() => bg({ type: "resume" })) }, "▶ Resume")
          : h("button.btn.secondary", { onclick: () => act(() => bg({ type: "pause" })) }, "❚❚ Pause"),
        h("button.btn.rec", { onclick: () => act(() => bg({ type: "stop" })) }, "■ Stop & review"),
      ),
      h("p.muted.small", { style: "margin:8px 0 0;text-align:center" }, "Shortcut: Alt+Shift+P pauses / resumes"),
    );
  }

  const shops = s.config!.testerConfig.shops;
  const tabShop = s.activeTab?.shop ?? null;
  const ready = !!s.calibration || s.settings.mouseAsGaze;
  const body: (Node | null)[] = [];
  if (tabShop) {
    body.push(
      h("p", { style: "margin:0 0 10px" }, "You are on ", h("b", null, tabShop.name), ". Start when you are ready to shop."),
      h(
        "button.btn.block",
        { disabled: !ready, onclick: () => act(() => bg({ type: "start_session", tabId: s.activeTab!.id })) },
        "● Start study session",
      ),
      !ready ? h("p.muted.small", { style: "margin:8px 0 0" }, "Calibrate the eye tracker first (below).") : null,
    );
  } else {
    body.push(
      h("p", { style: "margin:0 0 8px" }, "Open a study shop to begin – you will be asked to start a session there."),
      h(
        "div.shops",
        null,
        ...shops.flatMap((sh) =>
          sh.domains.slice(0, 1).map((d) =>
            h("a.chip.accent", { href: `${/^localhost|^\d/.test(d) ? "http" : "https"}://${d}/`, target: "_blank" }, `${sh.name} ↗`),
          ),
        ),
      ),
    );
  }
  body.push(
    h(
      "p.muted.small",
      { style: "margin:10px 0 0" },
      s.contextEntries
        ? `${s.contextEntries} pre-shop activit${s.contextEntries === 1 ? "y" : "ies"} buffered (last 30 min, stays on this computer unless you start a session).`
        : "No pre-shop activity buffered yet.",
    ),
  );
  return h("section.card", null, h("h2", null, "Study session"), ...body);
}

function helperCard(): HTMLElement {
  const s = state!;
  const hi = s.helper;
  const st = hi.status;
  const cell = (ok: boolean | null, label: string, value?: string) =>
    h("div.cell", null, h("span", { class: `dot ${ok === null ? "" : ok ? "good" : "bad"}` }), label, value ? h("b", null, value) : null);
  const q = s.calibration;
  const grade = q ? gradeFor(q.meanErrorDeg) : null;

  const head = h(
    "div.row",
    null,
    h("span", { class: `dot ${hi.connected && st ? "good" : hi.error ? "bad" : "warn"}` }),
    h("b", null, hi.connected && st ? `Gaze helper connected` : hi.connected ? "Connecting to gaze helper…" : "Gaze helper not connected"),
    h("div.spacer"),
    st ? h("span.muted.small", null, `v${st.version}`) : h("button.btn.ghost.small", { onclick: () => act(() => bg({ type: "connect_helper" })) }, "Retry"),
  );

  const nodes: (Node | null)[] = [h("h2", null, "Eye tracker"), head];
  if (s.settings.mouseAsGaze) {
    nodes.push(h("div.alert.warn", { style: "margin-top:10px" }, "Mouse-as-gaze debug mode is on – the helper is not used for new sessions."));
  }
  if (hi.error && !st) nodes.push(h("div.alert.bad", { style: "margin-top:10px" }, hi.error));
  if (st) {
    nodes.push(
      h(
        "div.status-grid",
        null,
        cell(st.cameras.rgb, "RGB cam"),
        cell(st.cameras.ir, "IR cam"),
        cell(st.cameras.irLit, "IR light"),
        cell(st.faceDetected, "Face"),
        cell(st.fps > 5 ? true : st.streaming ? false : null, "FPS", st.fps ? String(Math.round(st.fps)) : "–"),
        cell(st.calibrated, "Model"),
      ),
    );
  }
  nodes.push(
    h(
      "div.calib",
      { style: st ? "" : "margin-top:10px" },
      h("div.txt", null, h("b", null, "Calibration"), h("div.muted", null, calibrationSummary(q))),
      grade ? h("span", { class: `chip ${grade.tone}` }, grade.label) : null,
      h(
        "button",
        { class: q ? "btn secondary" : "btn", disabled: !!s.session && !s.session.paused, onclick: () => act(() => bg({ type: "open_calibration" })) },
        q ? "Recalibrate" : "Calibrate",
      ),
    ),
  );
  return h("section.card", null, ...nodes);
}

function pendingCard(): HTMLElement[] {
  const s = state!;
  if (!s.pendingReview.length) return [];
  return [
    h(
      "section.card.list",
      null,
      h("h2", null, "Waiting for your review", h("span.chip.warn", null, String(s.pendingReview.length))),
      ...s.pendingReview.map((p) =>
        h(
          "div.item",
          null,
          h(
            "div.grow",
            null,
            h("b", null, p.shopName),
            h("div.muted.small", null, `${fmtAgo(p.startedAt)} · ${fmtDuration((p.endedAt ?? Date.now()) - p.startedAt)}`),
          ),
          h("a.btn.secondary", { href: chrome.runtime.getURL(`review.html?id=${p.id}`), target: "_blank" }, "Review"),
        ),
      ),
    ),
  ];
}

function settingsCard(): HTMLElement {
  const s = state!;
  const sw = (key: "debugOverlay" | "mouseAsGaze", title: string, desc: string) => {
    const input = h("input", { type: "checkbox", checked: s.settings[key] });
    input.addEventListener("change", () => act(() => bg({ type: "set_settings", settings: { [key]: input.checked } })));
    return h("label.switch", null, h("span.label", null, h("b", null, title), h("small", null, desc)), input);
  };
  return h(
    "details.card.settings",
    null,
    h("summary", null, "Settings & privacy"),
    sw("debugOverlay", "Debug overlay", "Show gaze dot, fixations and AOI boxes on the shop."),
    sw("mouseAsGaze", "Mouse as gaze", "Testing without a camera. Sessions are marked as debug."),
    h(
      "div.links",
      null,
      h("a.btn.ghost.small", { href: chrome.runtime.getURL("review.html"), target: "_blank" }, "My sessions"),
      h("button.btn.ghost.small", { onclick: () => act(() => bg({ type: "refresh_config" }), "Shop list updated.") }, "Refresh shops"),
      h(
        "button.btn.ghost.small",
        {
          onclick: () => {
            if (confirm("Withdraw consent? The current session (if any) and the pre-shop buffer are deleted and nothing is recorded anymore."))
              void act(() => bg({ type: "withdraw_consent" }), "Consent withdrawn. Nothing is recorded.");
          },
        },
        "Withdraw consent",
      ),
      h(
        "button.btn.ghost.small",
        {
          onclick: () => {
            if (confirm("Reset the extension? All local sessions, calibration and settings are deleted.")) void act(() => bg({ type: "reset_all" }));
          },
        },
        "Reset",
      ),
    ),
  );
}

void refresh(true);
setInterval(() => void refresh(), 1000);
