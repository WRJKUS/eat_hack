# Cross-package conventions

Contracts live in `packages/shared/src` (`schemas.ts`, `native.ts`, `api.ts`, `url.ts`). They are imported as `@cm/shared` and are the single source of truth. If a contract must change, keep it backwards compatible and say so in your report.

## Runtime
- Node **20.17** (no newer Node available). Only use package versions that support Node 20.17. Deps are already installed via npm workspaces from the repo root. Avoid adding deps; if one is unavoidable, run `npm install <pkg> -w <workspace>` from the repo root.
- Python helper: `gaze-helper/` with uv (Python 3.12, OpenCV 5, MediaPipe 1.0.1 Tasks API, model at `gaze-helper/models/face_landmarker.task`).

## Ports & tokens (dev)
| Thing | Value |
|---|---|
| Server | `http://localhost:8787`, routes under `/api` |
| Dashboard | `http://localhost:5173` (Vite proxies `/api` → 8787) |
| Demo shop | `http://localhost:5174` |
| Owner token | env `OWNER_TOKEN`, default `dev-owner` |
| Demo shop id | `demo` |
| Demo tester | testerId `tester-demo`, token `demo-tester-token` |
| OpenAI | env `OPENAI_API_KEY`, model env `OPENAI_MODEL` (default `gpt-4.1-mini`) |
| SQLite + blobs | `server/data/` (gitignored) |

## Demo shop ("Demo Kitchen Shop") markup contract
Pages:
- `/` home with a product grid.
- `/category/:slug` (cookware, knives, pantry, appliances).
- `/products/:id`.
- `/cart` (cart lives in localStorage).
- `/checkout`.
- `/thank-you`.

| Element | Selector / attribute |
|---|---|
| Product card (grid) | `.product-card[data-product-id]` |
| Product image | `.product-image` |
| Price | `.price` |
| Product title | `.product-title` |
| Reviews block | `.reviews` |
| Primary CTA | `.btn-primary` |
| Add to cart button | `[data-action="add-to-cart"][data-product-id]` |
| Checkout button | `[data-action="checkout"]` |
| Place order | `[data-action="place-order"]` |

Product pages embed schema.org `Product` JSON-LD (`sku`, `name`, `offers.price`, `offers.priceCurrency`). Product ids: `pasta-machine`, `chef-knife`, `cast-iron-pan`, `olive-oil`, `stand-mixer`, `espresso-machine`, `cutting-board`, `spice-set`.

Seeded `ShopConfig` (server seed):
```json
{ "id": "demo", "name": "Demo Kitchen Shop", "domains": ["localhost:5174"],
  "selectors": { "product_card": ".product-card", "product_image": ".product-image", "price": ".price",
    "title": ".product-title", "reviews": ".reviews", "cta": ".btn-primary",
    "add_to_cart": "[data-action=\"add-to-cart\"]", "checkout": "[data-action=\"checkout\"]",
    "purchase": "[data-action=\"place-order\"]", "product_id_attr": "data-product-id" },
  "urlTemplates": [ { "pattern": "^/products/[^/]+$", "template": "/products/:id" },
                    { "pattern": "^/category/[^/]+$", "template": "/category/:slug" } ] }
```

## AOI ids
- With a product: `product:<productId>:<kind>`, e.g. `product:chef-knife:price`, `product:chef-knife:product_card`.
- Without one: `<kind>:<short-hash-of-selector>`.

## Privacy invariants (must hold everywhere)
- No camera frames ever leave the gaze-helper process: no saving to disk except an explicit local debug flag, and nothing over the wire.
- Gaze, fixations, rrweb and events are recorded **only** on hosts in the tester's shop allowlist, only while a session is recording and not paused.
- Pre-shop context is categorized (see `ContextCategory`) and lives in `chrome.storage.session`. It is a rolling 30-minute buffer that is discarded unless a study session starts. Titles are kept only for the categories listed in `schemas.ts`.
- rrweb runs with `maskAllInputs: true`.
- Testers can review, delete and pause. The owner can delete sessions.
