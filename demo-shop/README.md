# Demo Kitchen Shop

A small, realistic-looking kitchen store used for end-to-end testing of Cookie Monster. Story: a shopper watches a carbonara video, compares prices on geizhals.at, then lands here to buy a pasta machine.

- No dependencies. `node:http` server-side renders every page, so URLs are real paths.
- No external assets. Product images are inline SVG illustrations (`src/illustrations.mjs`).
- The cart lives in `localStorage` (`dks-cart`). The last order (contents only, never form data) is kept in `dks-last-order`.

## Run

```bash
npm run dev -w demo-shop      # or: npm start -w demo-shop
# → http://localhost:5174   (override with PORT=xxxx; QUIET=1 silences the request log)
```

## Files

| File | Purpose |
|---|---|
| `serve.mjs` | HTTP server and router. Serves static files under `/assets/*`. |
| `src/products.mjs` | Catalog: 8 products, categories, EUR prices, ratings, reviews, specs, "frequently bought together", shipping rules. |
| `src/render.mjs` | HTML templates for every page, plus the JSON-LD. |
| `src/illustrations.mjs` | Inline SVG product and hero illustrations. |
| `assets/shop.css` | Styles. Desktop-first (1280 px), responsive down to phones. |
| `assets/shop.js` | Cart, cart/checkout/thank-you rendering, order placement. |

## Routes

| Path | Page (`<body data-page>`) |
|---|---|
| `/` | `home`: hero banner, promo banner, category tiles, grid of all 8 products, trust row |
| `/category/:slug` | `category`: `cookware`, `knives`, `pantry`, `appliances`. Optional `?sort=price-asc\|price-desc\|rating` |
| `/products/:id` | `product`: product detail page with JSON-LD |
| `/cart` | `cart`: server-rendered shell, lines rendered client-side from localStorage |
| `/checkout` | `checkout`: fake form (email, name, street, postcode, city, country, payment) |
| `/thank-you` | `thank-you`: order number and contents. `POST /thank-you` redirects here with 303, as a no-JS fallback that ignores the form data |
| anything else | `404` page with status 404 |

Trailing slashes redirect with 301 to the path without the slash.

Product ids: `pasta-machine`, `chef-knife`, `cast-iron-pan`, `olive-oil`, `stand-mixer`, `espresso-machine`, `cutting-board`, `spice-set`.

## Markup contract (see `docs/CONVENTIONS.md`)

| Element | Markup |
|---|---|
| Product card | `article.product-card[data-product-id]`, on home, category, "frequently bought together" (`.product-card-compact`) and "customers also viewed" |
| Product image | `.product-image` (on cards and the product page's main image) |
| Price | `.price` |
| Title | `.product-title` (card `h3`, product page `h1`) |
| Reviews | `section.reviews#reviews` (product page) |
| Primary CTA | `.btn-primary` (hero CTA, product page add-to-cart, cart checkout, place order) |
| Add to cart | `[data-action="add-to-cart"][data-product-id]`, both the card button (`.btn-card-add`) and the product page `.btn-primary` |
| Checkout | `a[data-action="checkout"]` on `/cart` |
| Place order | `button[data-action="place-order"]` on `/checkout` |

Other details:
- On product pages the main content wrapper is `.product-page[data-product-id="<id>"]`, so price, title, image and reviews resolve to the product via `closest('[data-product-id]')`.
- Product pages embed schema.org `Product` JSON-LD with these fields: `sku`, `productID` (the product id), `name`, `offers.price` (a string such as `"69.90"`), `offers.priceCurrency: "EUR"`, `aggregateRating`, and `review[]`.
- Prices display in de-AT format, e.g. `€ 69,90`.
- `[data-cart-count]` in the header holds the cart item count.
- Checkout inputs are plain `<input>`s, so rrweb `maskAllInputs` masks them. The form uses `method="post"`, so personal data never ends up in a URL.

## Deliberate UX flaws (for interesting insights)

These are intentional. Please don't "fix" them. The analytics and AI feedback should find them.

1. **Reviews far below the fold** (`/products/:id`, `section.reviews#reviews`). Review texts are the very last block on the page, after the description, a recipe story, specs, "frequently bought together", delivery info and "customers also viewed". The star summary next to the title (`.rating-summary`) is plain text, not a jump link. Expected signals: `below_fold_unseen` / `key_info_missed` on reviews, and a low reviews share in `attentionSplit`.
2. **Hidden espresso-machine shipping surcharge**. The espresso machine is `bulky`. Its product page only says "Free shipping over € 50", and the cart shows shipping as "Free". Only `/checkout` adds the row "Bulky item delivery (freight) € 14,90" (`.checkout-surcharge`). The only on-page hint is one 3-star review buried at the bottom. Expected signals: hesitation or abandonment at checkout, `cart_abandon`, and long dwell on the order summary.
3. **Low-contrast add-to-cart on product cards** (`.btn-card-add`). A pale ghost button with about 1.7:1 contrast, so shoppers click through to the product page instead. Expected signals: cards viewed but the CTA ignored (`viewed_not_clicked`), and `long_visual_search` before clicking.
4. **Promo banner that looks clickable but isn't** (`.promo-banner` on `/`). It's a dark banner with a "Shop the deal →" call to action, `cursor: pointer` and a hover shadow, but it's a plain `<div>` with no link. Expected signals: `dead_click` / `rage_click` on the banner.

Minor realism details (not flaws): the header search box is decorative, and the "Credit card" payment option says card details come "on the next step" (there is none, since this is a demo).
