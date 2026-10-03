/* Consent text shared by the popup and the welcome page (one wording, one place). */
import type { TesterConfig } from "@cm/shared";
import { h } from "./common";

export function consentBody(tc: TesterConfig): Node[] {
  const shops = tc.shops;
  return [
    h("h2", null, "Before you take part"),
    h(
      "p",
      { style: "margin:0" },
      `You are invited as tester `,
      h("b", null, tc.testerId),
      ` to a usability study of ${shops.length === 1 ? "this shop" : "these shops"}:`,
    ),
    h("div.shops", null, ...shops.map((sh) => h("span.chip.accent", { title: sh.domains.join(", ") }, sh.name))),
    h("h3", null, "Recorded – only while you record a session"),
    h(
      "ul.yes",
      null,
      h("li", null, h("b", null, "Where you look"), " as screen coordinates, only on the study shops above."),
      h("li", null, h("b", null, "The page layout"), " for a replay of your visit. Everything you type is masked."),
      h("li", null, h("b", null, "Clicks, scrolling"), " and cart/checkout actions on the study shops."),
      h(
        "li",
        null,
        h("b", null, "What you did before"),
        " the shop in the last ~30 min, as categories only, e.g. “price comparison · geizhals.at” or “video · YouTube: pasta carbonara”. Unknown sites appear as domain only.",
      ),
    ),
    h("h3", null, "Kept on this computer from now on – shared only with a session"),
    h(
      "ul.ctl",
      null,
      h(
        "li",
        null,
        "From the moment you agree, the extension keeps a rolling list of the ",
        h("b", null, "kinds of sites"),
        " you visit (the categories above) for the last 30 minutes. It stays in browser memory, is never uploaded on its own and is discarded unless you start a study session.",
      ),
    ),
    h("h3", null, "Never recorded"),
    h(
      "ul.no",
      null,
      h("li", null, "Camera images or video – they never leave this computer."),
      h("li", null, "Your activity on other websites beyond the category summary above."),
      h("li", null, "Passwords, form contents, or anything while paused."),
    ),
    h("h3", null, "You stay in control"),
    h(
      "ul.ctl",
      null,
      h("li", null, "A red REC indicator shows whenever recording is on. Pause anytime (Alt+Shift+P)."),
      h("li", null, "Review every session and remove items before it is uploaded – or delete it."),
      h("li", null, "Delete uploaded sessions and withdraw consent here at any time."),
    ),
  ];
}
