import { useEffect, useState } from "react";
import { ShopConfig } from "@cm/shared";
import { api, DEFAULT_TOKEN, getToken, setToken } from "../api";
import { useShop } from "../lib/shop";
import { Icon } from "../components/Icons";
import { Card, ErrorState, PageHeader, Spinner } from "../components/ui";

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Owner access, study-shop configuration and tester invites." />
      <TokenCard />
      <ShopEditor />
      <TesterInvite />
    </div>
  );
}

function TokenCard() {
  const { bumpToken, reloadShops } = useShop();
  const [value, setValue] = useState(getToken());
  const [saved, setSaved] = useState(false);
  const [show, setShow] = useState(false);
  const save = () => {
    setToken(value.trim());
    bumpToken();
    reloadShops();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };
  return (
    <Card title="Owner token" subtitle="Sent as a Bearer token with every API request. Stored only in this browser (localStorage).">
      <div className="flex max-w-xl flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <label className="label" htmlFor="tok">Token</label>
          <div className="relative">
            <input id="tok" className="input pr-16 font-mono" type={show ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} autoComplete="off" />
            <button className="absolute inset-y-0 right-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <button className="btn btn-accent" onClick={save}>
          {saved ? <Icon name="check" size={14} /> : <Icon name="key" size={14} />} {saved ? "Saved" : "Save"}
        </button>
        <button className="btn btn-ghost" onClick={() => setValue(DEFAULT_TOKEN)}>Use dev default</button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Development default: <code className="font-mono">{DEFAULT_TOKEN}</code> (server env <code className="font-mono">OWNER_TOKEN</code>).
      </p>
    </Card>
  );
}

function pretty(v: unknown) {
  return JSON.stringify(v, null, 2);
}

function ShopEditor() {
  const { shop, reloadShops, setShopId, error: shopsError } = useShop();
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [selectors, setSelectors] = useState("{}");
  const [templates, setTemplates] = useState("[]");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (creating) {
      setId("");
      setName("");
      setDomains("");
      setSelectors(pretty({ product_card: ".product-card", price: ".price", title: ".product-title", add_to_cart: "[data-action=\"add-to-cart\"]", product_id_attr: "data-product-id" }));
      setTemplates(pretty([{ pattern: "^/products/[^/]+$", template: "/products/:id" }]));
    } else if (shop) {
      setId(shop.id);
      setName(shop.name);
      setDomains(shop.domains.join("\n"));
      setSelectors(pretty(shop.selectors ?? {}));
      setTemplates(pretty(shop.urlTemplates ?? []));
    }
    setError(null);
    setFieldError(null);
  }, [shop, creating]);

  const submit = async () => {
    setFieldError(null);
    setError(null);
    let sel: unknown;
    let tpl: unknown;
    try {
      sel = JSON.parse(selectors);
    } catch (e) {
      setFieldError(`Selectors: invalid JSON (${(e as Error).message})`);
      return;
    }
    try {
      tpl = JSON.parse(templates);
    } catch (e) {
      setFieldError(`URL templates: invalid JSON (${(e as Error).message})`);
      return;
    }
    const candidate = { id: id.trim() || "new", name: name.trim(), domains: domains.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean), selectors: sel, urlTemplates: tpl };
    const parsed = ShopConfig.safeParse(candidate);
    if (!parsed.success) {
      setFieldError(parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; "));
      return;
    }
    if (Array.isArray(tpl)) {
      for (const t of tpl as { pattern: string }[]) {
        try {
          new RegExp(t.pattern);
        } catch {
          setFieldError(`URL templates: invalid regex ${t.pattern}`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      if (creating) {
        const { id: maybeId, ...rest } = parsed.data;
        const created = await api.createShop(id.trim() ? parsed.data : { ...rest, ...(maybeId !== "new" ? { id: maybeId } : {}) });
        setCreating(false);
        reloadShops();
        setShopId(created.id);
      } else {
        await api.updateShop(parsed.data);
        reloadShops();
      }
      setOk(true);
      window.setTimeout(() => setOk(false), 1800);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={creating ? "New study shop" : `Shop configuration${shop ? ` · ${shop.name}` : ""}`}
      subtitle="Domains are the gaze allowlist; selectors and URL templates drive AOI detection and page grouping."
      actions={
        creating ? (
          <button className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
        ) : (
          <button className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New shop
          </button>
        )
      }
    >
      {!shop && !creating ? (
        shopsError ? <ErrorState error={shopsError} compact /> : <p className="text-sm text-zinc-500">No shop selected.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="sid">Shop id</label>
                <input id="sid" className="input font-mono" value={id} onChange={(e) => setId(e.target.value)} disabled={!creating} placeholder={creating ? "optional" : undefined} />
              </div>
              <div>
                <label className="label" htmlFor="sname">Name</label>
                <input id="sname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="sdom">Domains (one per line, host[:port])</label>
              <textarea id="sdom" className="input h-24 font-mono text-xs" value={domains} onChange={(e) => setDomains(e.target.value)} spellCheck={false} />
              <p className="mt-1 text-[11px] text-zinc-500">Gaze, DOM and events are recorded only on these hosts (and their subdomains).</p>
            </div>
            <div>
              <label className="label" htmlFor="stpl">URL templates (JSON)</label>
              <textarea id="stpl" className="input h-40 font-mono text-xs" value={templates} onChange={(e) => setTemplates(e.target.value)} spellCheck={false} />
              <p className="mt-1 text-[11px] text-zinc-500">
                <code>[{"{"}"pattern": "^/products/[^/]+$", "template": "/products/:id"{"}"}]</code> — regex on the pathname.
              </p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ssel">AOI selectors (JSON)</label>
            <textarea id="ssel" className="input h-[364px] font-mono text-xs" value={selectors} onChange={(e) => setSelectors(e.target.value)} spellCheck={false} />
            <p className="mt-1 text-[11px] text-zinc-500">Keys: product_card, product_image, price, title, reviews, cta, add_to_cart, checkout, purchase, product_id_attr.</p>
          </div>
          <div className="space-y-2 lg:col-span-2">
            {fieldError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{fieldError}</div>}
            {error && <ErrorState error={error} compact />}
            <button className="btn btn-accent" onClick={submit} disabled={busy}>
              {busy ? <Spinner className="size-3.5" /> : ok ? <Icon name="check" size={14} /> : null}
              {ok ? "Saved" : creating ? "Create shop" : "Save configuration"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TesterInvite() {
  const { shop } = useShop();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<{ testerId: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (!shop) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.createTester(shop.id, label.trim() || "Tester"));
      setLabel("");
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <Card title="Invite a tester" subtitle="Creates a pseudonymous tester and a token they paste into the browser extension. The token is shown only once.">
      {!shop ? (
        <p className="text-sm text-zinc-500">Select a shop first.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex max-w-xl flex-wrap items-end gap-2">
            <div className="min-w-60 flex-1">
              <label className="label" htmlFor="tl">Label (for you, e.g. “Panel A – #3”)</label>
              <input id="tl" className="input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Tester" />
            </div>
            <button className="btn btn-accent" onClick={create} disabled={busy}>
              {busy ? <Spinner className="size-3.5" /> : <Icon name="plus" size={14} />} Create invite
            </button>
          </div>
          {error && <ErrorState error={error} compact />}
          {result && (
            <div className="max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                <Icon name="checkCircle" size={15} /> Tester <code className="font-mono">{result.testerId}</code> created
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-emerald-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-emerald-500/30 dark:bg-zinc-900">{result.token}</code>
                <button className="btn" onClick={copy}>
                  <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-emerald-800/80 dark:text-emerald-200/80">Copy it now — it cannot be shown again. The tester enters it in the extension popup together with the server URL.</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
