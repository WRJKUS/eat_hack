// Server-side HTML rendering for every Demo Kitchen Shop page.
import { categories, products, productById, formatPrice, SHIPPING } from "./products.mjs";
import { productSvg } from "./illustrations.mjs";

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const categoryBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

function stars(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let out = "";
  for (let i = 0; i < 5; i++) out += i < full ? "★" : i === full && half ? "⯪" : "☆";
  return `<span class="stars" aria-label="${rating} out of 5 stars">${out.replace("⯪", '<span class="half">★</span>')}</span>`;
}

/** Catalog for client-side cart rendering (svg only where thumbnails are shown). */
function catalogScript(withSvg) {
  const data = Object.fromEntries(
    products.map((p) => [
      p.id,
      { id: p.id, name: p.name, price: p.price, bulky: !!p.bulky, ...(withSvg ? { svg: productSvg(p.id) } : {}) },
    ]),
  );
  const json = JSON.stringify({ products: data, shipping: SHIPPING }).replace(/</g, "\\u003c");
  return `<script id="catalog" type="application/json">${json}</script>`;
}

function layout({ title, page, body, head = "", withSvgCatalog = false, active = "" }) {
  const nav = categories
    .map((c) => `<a href="/category/${c.slug}" class="nav-link${active === c.slug ? " is-active" : ""}">${esc(c.name)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Demo Kitchen Shop</title>
<meta name="description" content="Demo Kitchen Shop — pasta machines, knives, cast iron and pantry staples for home cooks.">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/shop.css">
${head}
</head>
<body data-page="${esc(page)}">
<div class="topbar"><div class="container topbar-inner"><span>Free shipping on orders over ${formatPrice(SHIPPING.freeThreshold)}</span><span class="topbar-sep">·</span><span>30-day returns</span><span class="topbar-sep">·</span><span>Ships from Vienna in 1–2 days</span></div></div>
<header class="site-header">
  <div class="container header-inner">
    <a href="/" class="logo" aria-label="Demo Kitchen Shop home">
      <span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#B5432B"/><path d="M9 18c0-4 3-7 7-7s7 3 7 7" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M7 18h18v2a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" fill="#fff"/></svg></span>
      <span class="logo-text">Demo Kitchen<span class="logo-sub">Shop</span></span>
    </a>
    <nav class="main-nav" aria-label="Categories">${nav}</nav>
    <div class="header-search" role="search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M14 14l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" placeholder="Search pasta tools, knives…" aria-label="Search"></div>
    <a href="/cart" class="cart-link" aria-label="Cart">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="20" r="1.5" fill="currentColor"/><circle cx="17" cy="20" r="1.5" fill="currentColor"/></svg>
      <span>Cart</span><span class="cart-count" data-cart-count>0</span>
    </a>
  </div>
</header>
<main id="main" class="site-main">
${body}
</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div><div class="footer-brand">Demo Kitchen Shop</div><p class="muted">Tools and pantry staples for people who cook at home. Family-run in Vienna since 2009.</p></div>
    <div><h4>Shop</h4>${categories.map((c) => `<a href="/category/${c.slug}">${esc(c.name)}</a>`).join("")}</div>
    <div><h4>Help</h4><a href="/cart">Your cart</a><span>Shipping &amp; delivery</span><span>Returns</span><span>Contact: hello@demo-kitchen.test</span></div>
    <div><h4>Payment</h4><div class="pay-chips"><span>Visa</span><span>Mastercard</span><span>PayPal</span><span>Invoice</span></div></div>
  </div>
  <div class="container footer-bottom muted">© 2026 Demo Kitchen Shop · A demo store for usability research. No real orders are placed.</div>
</footer>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
${catalogScript(withSvgCatalog)}
<script src="/assets/shop.js" defer></script>
</body>
</html>`;
}

function priceBlock(p, large = false) {
  return `<div class="price-row${large ? " price-row-lg" : ""}"><span class="price">${formatPrice(p.price)}</span>${
    p.compareAt ? `<s class="compare-at">${formatPrice(p.compareAt)}</s>` : ""
  }</div>`;
}

export function productCard(p, { compact = false } = {}) {
  return `<article class="product-card${compact ? " product-card-compact" : ""}" data-product-id="${p.id}">
  <a class="product-card-link" href="/products/${p.id}">
    <div class="product-image">${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}${productSvg(p.id)}</div>
    <h3 class="product-title">${esc(p.name)}</h3>
  </a>
  <div class="card-rating">${stars(p.rating)}<span class="muted">(${p.reviewCount})</span></div>
  ${priceBlock(p)}
  <button type="button" class="btn-card-add" data-action="add-to-cart" data-product-id="${p.id}">Add to cart</button>
</article>`;
}

// ---------- pages ----------

export function homePage() {
  const featured = products;
  const body = `
<section class="hero">
  <div class="container hero-inner">
    <div class="hero-copy">
      <span class="eyebrow">Pasta season is here</span>
      <h1>Fresh pasta,<br>made at home.</h1>
      <p class="hero-lead">Everything you saw in that carbonara video — the machine, the skillet, the peppery oil. Hand-picked tools for home cooks, shipped from Vienna.</p>
      <div class="hero-ctas"><a href="/products/pasta-machine" class="btn-primary btn-lg">Shop the pasta machine</a><a href="/category/cookware" class="btn-outline btn-lg">Browse cookware</a></div>
      <ul class="hero-usps"><li>✓ 30-day returns</li><li>✓ Free shipping over ${formatPrice(SHIPPING.freeThreshold)}</li><li>✓ 4.7/5 from 1,200+ reviews</li></ul>
    </div>
    <div class="hero-art">${productSvg("hero")}</div>
  </div>
</section>

<div class="container">
  <div class="promo-banner" aria-label="Pasta Week promotion">
    <span class="promo-tag">Pasta Week</span>
    <span class="promo-text"><strong>15% off all pasta tools</strong> — this week only, automatically applied</span>
    <span class="promo-cta">Shop the deal <span aria-hidden="true">→</span></span>
  </div>

  <section class="section">
    <div class="section-head"><h2>Shop by category</h2></div>
    <div class="category-tiles">
      ${categories
        .map((c) => {
          const first = products.find((p) => p.category === c.slug);
          return `<a class="category-tile" href="/category/${c.slug}"><div class="category-tile-art">${productSvg(first.id)}</div><div class="category-tile-body"><h3>${esc(c.name)}</h3><span class="muted">${products.filter((p) => p.category === c.slug).length} products</span></div></a>`;
        })
        .join("")}
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Popular right now</h2><span class="muted">${featured.length} products</span></div>
    <div class="product-grid">${featured.map((p) => productCard(p)).join("")}</div>
  </section>

  <section class="section trust-row">
    <div class="trust"><strong>Tested in our kitchen</strong><span class="muted">Every product is used by our team for at least a month.</span></div>
    <div class="trust"><strong>Fair prices</strong><span class="muted">We check comparison sites weekly and match where we can.</span></div>
    <div class="trust"><strong>Real humans</strong><span class="muted">Questions? Our cooks answer within one working day.</span></div>
  </section>
</div>`;
  return layout({ title: "Fresh pasta, made at home", page: "home", body });
}

export function categoryPage(slug, sort = "") {
  const cat = categoryBySlug[slug];
  if (!cat) return null;
  let list = products.filter((p) => p.category === slug);
  if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
  else if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
  else if (sort === "rating") list = [...list].sort((a, b) => b.rating - a.rating);
  const others = products.filter((p) => p.category !== slug).slice(0, 4);
  const sortLink = (v, label) => `<a href="/category/${slug}${v ? `?sort=${v}` : ""}" class="sort-link${sort === v ? " is-active" : ""}">${label}</a>`;
  const body = `
<div class="container">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><span>${esc(cat.name)}</span></nav>
  <section class="category-hero" style="--cat:${cat.accent}">
    <div><h1>${esc(cat.name)}</h1><p>${esc(cat.blurb)}</p></div>
  </section>
  <div class="toolbar"><span class="muted">${list.length} products</span><div class="sort">Sort: ${sortLink("", "Featured")}${sortLink("price-asc", "Price ↑")}${sortLink("price-desc", "Price ↓")}${sortLink("rating", "Rating")}</div></div>
  <div class="product-grid product-grid-cat">${list.map((p) => productCard(p)).join("")}</div>
  <section class="section">
    <div class="section-head"><h2>You might also like</h2></div>
    <div class="product-grid">${others.map((p) => productCard(p)).join("")}</div>
  </section>
</div>`;
  return layout({ title: cat.name, page: "category", body, active: slug });
}

function jsonLd(p) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    sku: p.sku,
    productID: p.id,
    name: p.name,
    description: p.tagline,
    category: categoryBySlug[p.category]?.name,
    brand: { "@type": "Brand", name: "Demo Kitchen" },
    aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviewCount },
    offers: {
      "@type": "Offer",
      price: p.price.toFixed(2),
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      url: `/products/${p.id}`,
    },
    review: p.reviews.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      datePublished: r.date,
      reviewRating: { "@type": "Rating", ratingValue: r.rating },
      name: r.title,
      reviewBody: r.text,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}

function reviewDistribution(p) {
  // Plausible distribution derived from the average.
  const r = p.rating;
  const five = Math.round(Math.min(0.9, Math.max(0.3, (r - 3.2) / 1.9)) * 100);
  const four = Math.round((100 - five) * 0.62);
  const three = Math.round((100 - five - four) * 0.6);
  const two = Math.round((100 - five - four - three) * 0.6);
  const one = Math.max(0, 100 - five - four - three - two);
  return [
    [5, five],
    [4, four],
    [3, three],
    [2, two],
    [1, one],
  ];
}

export function productPage(id) {
  const p = productById[id];
  if (!p) return null;
  const cat = categoryBySlug[p.category];
  const together = p.boughtTogether.map((x) => productById[x]).filter(Boolean);
  const bundleTotal = [p, ...together].reduce((s, x) => s + x.price, 0);
  const related = products.filter((x) => x.category === p.category && x.id !== p.id).concat(products.filter((x) => x.category !== p.category)).slice(0, 4);
  const specs = Object.entries(p.specs).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const body = `
<div class="container product-page" data-product-id="${p.id}">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/category/${cat.slug}">${esc(cat.name)}</a><span>/</span><span>${esc(p.name)}</span></nav>
  <section class="pdp">
    <div class="pdp-gallery">
      <div class="product-image pdp-image">${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}${productSvg(p.id)}</div>
      <div class="pdp-thumbs" aria-hidden="true"><div class="thumb is-active">${productSvg(p.id)}</div><div class="thumb thumb-alt">${productSvg(p.id)}</div><div class="thumb thumb-alt2">${productSvg(p.id)}</div></div>
    </div>
    <div class="pdp-info">
      <span class="eyebrow">${esc(cat.name)}</span>
      <h1 class="product-title">${esc(p.name)}</h1>
      <div class="rating-summary">${stars(p.rating)}<span>${p.rating.toFixed(1)}</span><span class="muted">· ${p.reviewCount} reviews</span></div>
      <p class="pdp-tagline">${esc(p.tagline)}</p>
      ${priceBlock(p, true)}
      <div class="muted small">incl. 20% VAT · <span class="ship-note">Free shipping over ${formatPrice(SHIPPING.freeThreshold)}</span></div>
      <div class="stock ${p.stock.startsWith("Only") ? "stock-low" : ""}"><span class="dot"></span>${esc(p.stock)} · delivered in 2–4 working days</div>
      <div class="buy-row">
        <label class="qty"><span class="sr-only">Quantity</span><button type="button" class="qty-btn" data-qty-step="-1" aria-label="Decrease">−</button><input type="number" min="1" max="10" value="1" data-qty-for="${p.id}" aria-label="Quantity"><button type="button" class="qty-btn" data-qty-step="1" aria-label="Increase">+</button></label>
        <button type="button" class="btn-primary btn-lg btn-add" data-action="add-to-cart" data-product-id="${p.id}">Add to cart</button>
      </div>
      <ul class="highlights">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
      <div class="pdp-perks"><div><strong>30-day returns</strong><span class="muted">Free return label</span></div><div><strong>Secure payment</strong><span class="muted">Card, PayPal, invoice</span></div></div>
    </div>
  </section>

  <section class="section pdp-section">
    <h2>About this product</h2>
    <div class="prose">${p.description.map((d) => `<p>${esc(d)}</p>`).join("")}</div>
  </section>

  <section class="section pdp-section kitchen-story">
    <div class="story-art">${productSvg("hero")}</div>
    <div class="story-copy"><span class="eyebrow">From our kitchen</span><h2>Spaghetti carbonara, the Roman way</h2><p>Guanciale rendered slowly in cast iron, eggs and pecorino whisked with plenty of black pepper, tossed off the heat with fresh pasta. No cream — ever. Our cooks made it forty times to get the timing right, and these are the tools they reached for.</p><ol class="steps"><li>Roll and cut the pasta (setting 6 for spaghetti alla chitarra).</li><li>Render 150 g guanciale until crisp.</li><li>Whisk 4 yolks, 1 egg, 60 g pecorino, lots of pepper.</li><li>Toss everything off the heat with a splash of pasta water.</li></ol></div>
  </section>

  <section class="section pdp-section">
    <h2>Specifications</h2>
    <table class="specs">${specs}</table>
  </section>

  <section class="section pdp-section">
    <h2>Frequently bought together</h2>
    <div class="fbt">
      <div class="fbt-items">${[p, ...together].map((x) => productCard(x, { compact: true })).join('<span class="fbt-plus">+</span>')}</div>
      <div class="fbt-total"><span class="muted">Total for all ${together.length + 1}</span><strong>${formatPrice(bundleTotal)}</strong><button type="button" class="btn-outline" data-action="add-bundle" data-product-ids="${[p, ...together].map((x) => x.id).join(",")}">Add all to cart</button></div>
    </div>
  </section>

  <section class="section pdp-section">
    <h2>Delivery &amp; returns</h2>
    <div class="info-grid">
      <div><h3>Delivery</h3><p class="muted">Orders placed before 2 pm ship the same day from Vienna. Delivery within Austria in 1–2 working days, Germany 2–4 working days. Free shipping on orders over ${formatPrice(SHIPPING.freeThreshold)}.</p></div>
      <div><h3>Returns</h3><p class="muted">Changed your mind? Return unused items within 30 days for a full refund. We include a prepaid return label with every order.</p></div>
      <div><h3>Warranty</h3><p class="muted">${esc(p.specs.Warranty || "2 years")} manufacturer warranty, handled directly by us — no forms to fill.</p></div>
      <div><h3>Care</h3><p class="muted">Every product ships with a printed care card. Questions? Our cooks are one email away.</p></div>
    </div>
  </section>

  <section class="section pdp-section">
    <div class="section-head"><h2>Customers also viewed</h2></div>
    <div class="product-grid">${related.map((x) => productCard(x)).join("")}</div>
  </section>

  <section class="section pdp-section reviews" id="reviews">
    <h2>Customer reviews</h2>
    <div class="reviews-layout">
      <div class="reviews-summary">
        <div class="reviews-score">${p.rating.toFixed(1)}</div>${stars(p.rating)}<div class="muted">${p.reviewCount} verified reviews</div>
        <div class="dist">${reviewDistribution(p).map(([s, pct]) => `<div class="dist-row"><span>${s}★</span><span class="dist-bar"><span style="width:${pct}%"></span></span><span class="muted">${pct}%</span></div>`).join("")}</div>
      </div>
      <div class="review-list">
        ${p.reviews
          .map(
            (r) => `<article class="review"><div class="review-head">${stars(r.rating)}<strong>${esc(r.title)}</strong></div><p>${esc(r.text)}</p><div class="muted small">${esc(r.author)} · ${esc(r.date)} · Verified purchase</div></article>`,
          )
          .join("")}
      </div>
    </div>
  </section>
</div>`;
  return layout({ title: p.name, page: "product", body, head: jsonLd(p), active: p.category });
}

export function cartPage() {
  const body = `
<div class="container narrow-top">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><span>Cart</span></nav>
  <h1 class="page-title">Your cart</h1>
  <div class="cart-layout">
    <section class="cart-items" data-cart-items><div class="skeleton">Loading your cart…</div></section>
    <aside class="cart-summary card">
      <h2>Order summary</h2>
      <div class="sum-row"><span>Subtotal</span><span data-sum="subtotal">–</span></div>
      <div class="sum-row"><span>Shipping</span><span data-sum="shipping">–</span></div>
      <div class="sum-row sum-total"><span>Total</span><span data-sum="total">–</span></div>
      <div class="muted small">incl. 20% VAT</div>
      <a href="/checkout" class="btn-primary btn-lg btn-block" data-action="checkout">Proceed to checkout</a>
      <a href="/" class="continue-link">← Continue shopping</a>
      <div class="pay-chips"><span>Visa</span><span>Mastercard</span><span>PayPal</span><span>Invoice</span></div>
    </aside>
  </div>
</div>`;
  return layout({ title: "Cart", page: "cart", body, withSvgCatalog: true });
}

export function checkoutPage() {
  const body = `
<div class="container narrow-top">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/cart">Cart</a><span>/</span><span>Checkout</span></nav>
  <h1 class="page-title">Checkout</h1>
  <form class="checkout-layout" id="checkout-form" method="post" action="/thank-you" novalidate>
    <div class="checkout-main">
      <section class="card form-card">
        <h2><span class="step">1</span> Contact</h2>
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label>
      </section>
      <section class="card form-card">
        <h2><span class="step">2</span> Shipping address</h2>
        <div class="field-row"><label class="field"><span>First name</span><input name="firstName" autocomplete="given-name" required></label><label class="field"><span>Last name</span><input name="lastName" autocomplete="family-name" required></label></div>
        <label class="field"><span>Street and number</span><input name="street" autocomplete="street-address" required></label>
        <div class="field-row"><label class="field field-sm"><span>Postcode</span><input name="zip" autocomplete="postal-code" required></label><label class="field"><span>City</span><input name="city" autocomplete="address-level2" required></label></div>
        <label class="field"><span>Country</span><select name="country" autocomplete="country"><option>Austria</option><option>Germany</option><option>Switzerland</option><option>Italy</option></select></label>
      </section>
      <section class="card form-card">
        <h2><span class="step">3</span> Payment</h2>
        <label class="radio"><input type="radio" name="payment" value="invoice" checked> <span><strong>Invoice</strong> <span class="muted">— pay within 14 days</span></span></label>
        <label class="radio"><input type="radio" name="payment" value="paypal"> <span><strong>PayPal</strong></span></label>
        <label class="radio"><input type="radio" name="payment" value="card"> <span><strong>Credit card</strong> <span class="muted">— entered on the next step</span></span></label>
      </section>
    </div>
    <aside class="card checkout-summary">
      <h2>Your order</h2>
      <div class="checkout-lines" data-checkout-lines><div class="skeleton">Loading…</div></div>
      <div class="sum-row"><span>Subtotal</span><span data-sum="subtotal">–</span></div>
      <div class="sum-row"><span>Shipping</span><span data-sum="shipping">–</span></div>
      <div class="sum-row checkout-surcharge" data-surcharge hidden><span>Bulky item delivery (freight)</span><span data-sum="surcharge">–</span></div>
      <div class="sum-row sum-total"><span>Total</span><span data-sum="total">–</span></div>
      <div class="muted small">incl. 20% VAT</div>
      <label class="radio small terms"><input type="checkbox" name="terms" required> <span>I accept the terms and conditions and the privacy notice.</span></label>
      <button type="submit" class="btn-primary btn-lg btn-block" data-action="place-order">Place order</button>
      <p class="muted small center">This is a demo store — no payment is taken.</p>
    </aside>
  </form>
</div>`;
  return layout({ title: "Checkout", page: "checkout", body, withSvgCatalog: true });
}

export function thankYouPage() {
  const body = `
<div class="container thank-you">
  <div class="card thank-card">
    <div class="check-circle" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#2F6B4F"/><path d="M14 25l7 7 13-15" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1>Thank you for your order!</h1>
    <p class="muted">Order <strong data-order-no>DKS-—</strong> · A confirmation email is on its way.</p>
    <div class="thank-lines" data-order-lines></div>
    <a href="/" class="btn-primary btn-lg">Continue shopping</a>
  </div>
</div>`;
  return layout({ title: "Thank you", page: "thank-you", body, withSvgCatalog: true });
}

export function notFoundPage(path) {
  const body = `
<div class="container not-found">
  <div class="nf-code">404</div>
  <h1>We couldn't find that page</h1>
  <p class="muted">Nothing lives at <code>${esc(path)}</code>. Maybe it was eaten?</p>
  <div class="hero-ctas center"><a href="/" class="btn-primary">Back to the shop</a><a href="/category/cookware" class="btn-outline">Browse cookware</a></div>
</div>`;
  return layout({ title: "Page not found", page: "404", body });
}
