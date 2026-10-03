import type { ShopConfig } from "@cm/shared";

/** Seeded demo ShopConfig (docs/CONVENTIONS.md). */
export const demoShop: ShopConfig = {
  id: "demo",
  name: "Demo Kitchen Shop",
  domains: ["localhost:5174"],
  selectors: {
    product_card: ".product-card",
    product_image: ".product-image",
    price: ".price",
    title: ".product-title",
    reviews: ".reviews",
    cta: ".btn-primary",
    add_to_cart: '[data-action="add-to-cart"]',
    checkout: '[data-action="checkout"]',
    purchase: '[data-action="place-order"]',
    product_id_attr: "data-product-id",
  },
  urlTemplates: [
    { pattern: "^/products/[^/]+$", template: "/products/:id" },
    { pattern: "^/category/[^/]+$", template: "/category/:slug" },
  ],
};

export const homeHtml = `
<header class="site-header"><a href="/" class="logo">Demo Kitchen Shop</a><a href="/cart" class="cart-link">Cart (0)</a></header>
<main>
  <h1>Kitchen favourites</h1>
  <div class="product-grid">
    <article class="product-card" data-product-id="chef-knife">
      <a href="/products/chef-knife"><img class="product-image" src="/img/chef-knife.jpg" alt="Chef knife"></a>
      <h2 class="product-title">Chef's Knife 20 cm</h2>
      <div class="reviews">★★★★☆ (128)</div>
      <span class="price">€ 89,90</span>
      <button class="btn-primary" data-action="add-to-cart" data-product-id="chef-knife">In den Warenkorb</button>
    </article>
    <article class="product-card" data-product-id="pasta-machine">
      <a href="/products/pasta-machine"><img class="product-image" src="/img/pasta.jpg" alt="Pasta machine"></a>
      <h2 class="product-title">Pasta Machine</h2>
      <div class="reviews">★★★★★ (54)</div>
      <span class="price">€ 59,00</span>
      <button class="btn-primary" data-action="add-to-cart" data-product-id="pasta-machine">In den Warenkorb</button>
    </article>
  </div>
  <aside class="newsletter"><p>Sign up and get <span class="promo">10% off</span></p><input type="email" value="secret@example.com"></aside>
</main>`;

export const productHtml = `
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","sku":"DKS-CI-28","productID":"cast-iron-pan","name":"Cast Iron Pan 28 cm",
 "offers":{"@type":"Offer","price":"49.90","priceCurrency":"EUR"}}
</script>
<main class="container product-page" data-product-id="cast-iron-pan">
  <div class="gallery"><img class="product-image" src="/img/pan.jpg" alt=""></div>
  <div class="info">
    <h1 class="product-title">Cast Iron Pan 28 cm</h1>
    <div class="reviews">★★★★☆ 4.6 (212 reviews)</div>
    <p class="price">€ 49,90</p>
    <button class="btn-primary" data-action="add-to-cart" data-product-id="cast-iron-pan">Add to cart</button>
  </div>
  <section class="related">
    <article class="product-card" data-product-id="olive-oil">
      <h3 class="product-title">Olive Oil</h3><span class="price">€ 14,90</span>
    </article>
  </section>
</main>`;

/** Shop without selectors: heuristics + microdata only. */
export const unknownShopHtml = `
<div itemscope itemtype="https://schema.org/Product">
  <h1 itemprop="name">Espresso Machine</h1>
  <meta itemprop="sku" content="espresso-machine">
  <div class="cost"><span>299,00 €</span></div>
  <a href="#" class="buy">Jetzt kaufen</a>
</div>
<footer><span>Versand ab 4,90 €</span></footer>`;
