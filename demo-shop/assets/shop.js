// Demo Kitchen Shop client script: localStorage cart, cart/checkout rendering, order placement.
(function () {
  "use strict";
  var CART_KEY = "dks-cart";
  var ORDER_KEY = "dks-last-order";

  var catalogEl = document.getElementById("catalog");
  var catalog = catalogEl ? JSON.parse(catalogEl.textContent) : { products: {}, shipping: { freeThreshold: 50, standard: 4.9, bulkySurcharge: 14.9 } };
  var P = catalog.products;
  var S = catalog.shipping;
  var fmt = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
  var money = function (n) { return fmt.format(n); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };

  // ---------- storage ----------
  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function getCart() {
    return load(CART_KEY, []).filter(function (l) { return l && P[l.id] && l.qty > 0; });
  }
  function setCart(cart) { store(CART_KEY, cart); refresh(); }
  function addToCart(id, qty) {
    if (!P[id]) return;
    var cart = getCart();
    var line = cart.find(function (l) { return l.id === id; });
    if (line) line.qty = Math.min(10, line.qty + qty); else cart.push({ id: id, qty: qty });
    setCart(cart);
  }
  function setQty(id, qty) {
    var cart = getCart();
    cart = qty <= 0 ? cart.filter(function (l) { return l.id !== id; }) : cart.map(function (l) { return l.id === id ? { id: id, qty: Math.min(10, qty) } : l; });
    setCart(cart);
  }

  function totals(cart, withSurcharge) {
    var subtotal = cart.reduce(function (s, l) { return s + P[l.id].price * l.qty; }, 0);
    var shipping = subtotal === 0 || subtotal >= S.freeThreshold ? 0 : S.standard;
    // Deliberate UX flaw: bulky-item freight surcharge only exists at checkout.
    var surcharge = withSurcharge && cart.some(function (l) { return P[l.id].bulky; }) ? S.bulkySurcharge : 0;
    return { subtotal: subtotal, shipping: shipping, surcharge: surcharge, total: subtotal + shipping + surcharge, count: cart.reduce(function (s, l) { return s + l.qty; }, 0) };
  }

  // ---------- UI ----------
  var toastTimer;
  function toast(html) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); setTimeout(function () { el.hidden = true; }, 250); }, 2800);
  }

  function setText(sel, v) { document.querySelectorAll(sel).forEach(function (el) { el.textContent = v; }); }

  function renderCount() {
    var n = totals(getCart(), false).count;
    document.querySelectorAll("[data-cart-count]").forEach(function (el) {
      el.textContent = String(n);
      el.classList.toggle("is-empty", n === 0);
    });
  }

  function renderCart() {
    var root = document.querySelector("[data-cart-items]");
    if (!root) return;
    var cart = getCart();
    var checkoutBtn = document.querySelector('[data-action="checkout"]');
    if (!cart.length) {
      root.innerHTML = '<div class="empty-cart card"><h2>Your cart is empty</h2><p class="muted">Looks like you haven\'t added anything yet.</p><a class="btn-primary" href="/">Start shopping</a></div>';
      if (checkoutBtn) checkoutBtn.classList.add("is-disabled");
    } else {
      if (checkoutBtn) checkoutBtn.classList.remove("is-disabled");
      root.innerHTML = cart.map(function (l) {
        var p = P[l.id];
        return '<div class="cart-line" data-cart-line="' + p.id + '">' +
          '<a class="cart-thumb" href="/products/' + p.id + '">' + (p.svg || "") + "</a>" +
          '<div class="cart-line-info"><a class="cart-line-title" href="/products/' + p.id + '">' + esc(p.name) + '</a><div class="muted small">' + money(p.price) + ' each</div>' +
          '<button type="button" class="link-btn" data-remove="' + p.id + '">Remove</button></div>' +
          '<div class="qty"><button type="button" class="qty-btn" data-line-step="-1" data-id="' + p.id + '" aria-label="Decrease">−</button>' +
          '<input type="number" min="0" max="10" value="' + l.qty + '" data-line-qty="' + p.id + '" aria-label="Quantity"><button type="button" class="qty-btn" data-line-step="1" data-id="' + p.id + '" aria-label="Increase">+</button></div>' +
          '<div class="cart-line-total">' + money(p.price * l.qty) + "</div></div>";
      }).join("");
    }
    var t = totals(cart, false);
    setText('[data-sum="subtotal"]', money(t.subtotal));
    setText('[data-sum="shipping"]', t.subtotal === 0 ? "–" : t.shipping === 0 ? "Free" : money(t.shipping));
    setText('[data-sum="total"]', money(t.total));
  }

  function renderCheckout() {
    var root = document.querySelector("[data-checkout-lines]");
    if (!root) return;
    var cart = getCart();
    var place = document.querySelector('[data-action="place-order"]');
    if (!cart.length) {
      root.innerHTML = '<p class="muted">Your cart is empty. <a href="/">Continue shopping</a></p>';
      if (place) place.disabled = true;
    } else {
      if (place) place.disabled = false;
      root.innerHTML = cart.map(function (l) {
        var p = P[l.id];
        return '<div class="checkout-line"><span class="checkout-thumb">' + (p.svg || "") + '<span class="qty-pill">' + l.qty + '</span></span><span class="checkout-line-name">' + esc(p.name) + "</span><span>" + money(p.price * l.qty) + "</span></div>";
      }).join("");
    }
    var t = totals(cart, true);
    setText('[data-sum="subtotal"]', money(t.subtotal));
    setText('[data-sum="shipping"]', t.subtotal === 0 ? "–" : t.shipping === 0 ? "Free" : money(t.shipping));
    setText('[data-sum="surcharge"]', money(t.surcharge));
    var row = document.querySelector("[data-surcharge]");
    if (row) row.hidden = t.surcharge === 0;
    setText('[data-sum="total"]', money(t.total));
  }

  function renderThankYou() {
    var lines = document.querySelector("[data-order-lines]");
    if (!lines) return;
    var order = load(ORDER_KEY, null);
    if (!order) { lines.innerHTML = '<p class="muted">No recent order found.</p>'; return; }
    setText("[data-order-no]", order.no);
    lines.innerHTML = order.items.map(function (l) {
      var p = P[l.id];
      return p ? '<div class="checkout-line"><span class="checkout-thumb">' + (p.svg || "") + '<span class="qty-pill">' + l.qty + '</span></span><span class="checkout-line-name">' + esc(p.name) + "</span><span>" + money(p.price * l.qty) + "</span></div>" : "";
    }).join("") + '<div class="sum-row sum-total"><span>Total paid</span><span>' + money(order.total) + "</span></div>";
  }

  function refresh() { renderCount(); renderCart(); renderCheckout(); }

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;

    var add = t.closest('[data-action="add-to-cart"]');
    if (add) {
      e.preventDefault();
      var id = add.getAttribute("data-product-id");
      var qtyInput = document.querySelector('[data-qty-for="' + id + '"]');
      var qty = Math.max(1, Math.min(10, parseInt(qtyInput && add.closest(".pdp-info") ? qtyInput.value : "1", 10) || 1));
      addToCart(id, qty);
      add.classList.add("is-added");
      setTimeout(function () { add.classList.remove("is-added"); }, 1200);
      toast("<strong>Added to cart</strong> · " + esc(P[id] ? P[id].name : id) + ' <a href="/cart">View cart →</a>');
      return;
    }

    var bundle = t.closest('[data-action="add-bundle"]');
    if (bundle) {
      (bundle.getAttribute("data-product-ids") || "").split(",").forEach(function (id) { addToCart(id, 1); });
      toast('<strong>Bundle added</strong> <a href="/cart">View cart →</a>');
      return;
    }

    var step = t.closest("[data-qty-step]");
    if (step) {
      var input = step.parentElement.querySelector("input");
      input.value = String(Math.max(1, Math.min(10, (parseInt(input.value, 10) || 1) + Number(step.getAttribute("data-qty-step")))));
      return;
    }

    var lineStep = t.closest("[data-line-step]");
    if (lineStep) {
      var lid = lineStep.getAttribute("data-id");
      var line = getCart().find(function (l) { return l.id === lid; });
      setQty(lid, (line ? line.qty : 0) + Number(lineStep.getAttribute("data-line-step")));
      return;
    }

    var rm = t.closest("[data-remove]");
    if (rm) { setQty(rm.getAttribute("data-remove"), 0); return; }

    var checkout = t.closest('[data-action="checkout"]');
    if (checkout && checkout.classList.contains("is-disabled")) { e.preventDefault(); toast("Your cart is empty."); }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t instanceof HTMLInputElement && t.hasAttribute("data-line-qty")) setQty(t.getAttribute("data-line-qty"), parseInt(t.value, 10) || 0);
  });

  var form = document.getElementById("checkout-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.classList.add("was-validated"); form.reportValidity(); return; }
      var cart = getCart();
      if (!cart.length) return;
      var t = totals(cart, true);
      // Only order contents are kept — never the personal data typed into the form.
      store(ORDER_KEY, { no: "DKS-" + String(Date.now()).slice(-6), items: cart, total: t.total, at: Date.now() });
      store(CART_KEY, []);
      location.href = "/thank-you";
    });
  }

  // Keep the header count in sync across tabs.
  window.addEventListener("storage", function (e) { if (e.key === CART_KEY) refresh(); });

  refresh();
  renderThankYou();
})();
