/*
 * Welcome page, opened once when the extension is installed: connect to the study with the invite baked into
 * the build, show the consent text, agree once – done. Falls back to manual invite entry when no invite is
 * baked in or the study server is unreachable.
 */
import type { PopupState } from "../lib/messages";
import { STUDY_CONFIG } from "../lib/study-config";
import { $, bg, calibrationSummary, h } from "./common";
import { consentBody } from "./consent";

const app = $("#app");

function show(...nodes: Node[]): void {
  app.replaceChildren(...nodes);
}

async function state(): Promise<PopupState> {
  const r = await bg<PopupState>({ type: "get_state" });
  if (!r.ok) throw new Error(r.error ?? "The extension background is not reachable.");
  return r;
}

async function render(): Promise<void> {
  let s = await state();
  if (!s.config && STUDY_CONFIG.inviteToken) {
    show(h("div.card.hero", null, h("p.muted", null, `Connecting to the study at ${STUDY_CONFIG.serverUrl}…`)));
    const r = await bg({ type: "set_config", serverUrl: STUDY_CONFIG.serverUrl, token: STUDY_CONFIG.inviteToken });
    if (!r.ok) return show(connectView(r.error ?? "Could not reach the study server."));
    s = await state();
  }
  if (!s.config) return show(connectView(null));
  if (!s.consent) return show(consentView(s));
  show(doneView(s));
}

function connectView(error: string | null): HTMLElement {
  const server = h("input", { type: "url", value: STUDY_CONFIG.serverUrl, required: true, spellcheck: false });
  const token = h("input", { type: "text", value: STUDY_CONFIG.inviteToken, placeholder: "Invite code from the research team", autocomplete: "off", spellcheck: false });
  const err = h("div.alert.bad", { hidden: !error }, error ?? "");
  const btn = h("button.btn.big", { type: "submit" }, "Connect");
  return h(
    "form.card",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = "Connecting…";
        const r = await bg({ type: "set_config", serverUrl: server.value, token: token.value });
        if (r.ok) return void render();
        btn.disabled = false;
        btn.textContent = "Connect";
        err.textContent = r.error ?? "Could not connect.";
        err.hidden = false;
      },
    },
    h("h2", null, "Join the study"),
    h("p.muted", null, error ? "The study server could not be reached. Check that it is running, then try again." : "Enter the study server and your invite code."),
    h("label.field", null, h("span", null, "Study server"), server),
    h("label.field", null, h("span", null, "Invite code"), token),
    err,
    btn,
  );
}

function consentView(s: PopupState): HTMLElement {
  const check = h("input", { type: "checkbox" });
  const go = h("button.btn.big.block", { disabled: true }, "I agree – start the study");
  const err = h("div.alert.bad", { hidden: true });
  check.addEventListener("change", () => (go.disabled = !check.checked));
  go.addEventListener("click", async () => {
    go.disabled = true;
    const r = await bg({ type: "give_consent" });
    if (!r.ok) {
      err.textContent = r.error ?? "Something went wrong.";
      err.hidden = false;
      go.disabled = false;
      return;
    }
    await render();
  });
  return h(
    "section.card.consent",
    null,
    ...consentBody(s.config!.testerConfig),
    h("label.agree", null, check, h("span", null, "I have read this and explicitly agree to take part. I can withdraw at any time in the extension popup.")),
    err,
    go,
  );
}

function doneView(s: PopupState): Node {
  const shops = s.config!.testerConfig.shops;
  const calibrated = !!s.calibration;
  const calibrate = h("button.btn.big", { onclick: () => void bg({ type: "open_calibration" }) }, calibrated ? "Recalibrate" : "Calibrate the eye tracker");
  return h(
    "div.stack",
    null,
    h(
      "div.card.hero",
      null,
      h("div.big", null, "✓"),
      h("h1", null, "You're in – thank you!"),
      h("p.muted", null, "There's nothing else to set up. From now on the extension notes the kinds of sites you visit, on this computer only, so the study can see what led you to the shop."),
    ),
    h(
      "section.card",
      null,
      h("h2", null, "What happens next"),
      h(
        "ol.next",
        null,
        h("li", null, h("b", null, "Calibrate once"), " so the eye tracker knows where you look (about 30 seconds, follow a dot). ", calibrated ? h("span.muted", null, `Done: ${calibrationSummary(s.calibration!)}.`) : null),
        h("li", null, h("b", null, "Browse as usual"), " – watch videos, compare prices, search. Nothing leaves your computer."),
        h(
          "li",
          null,
          h("b", null, "Shop"),
          " at ",
          ...shops.flatMap((sh, i) => [i ? ", " : "", h("a", { href: `http://${sh.domains[0]}/`, target: "_blank" }, sh.name)]),
          ". A small banner asks to start the study session; a red REC pill shows while recording. When you are done, review what is shared and upload.",
        ),
      ),
      h("div.row", { style: "margin-top:14px" }, calibrate),
    ),
  );
}

void render().catch((e) => show(h("div.alert.bad", null, (e as Error).message)));
