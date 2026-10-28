/* Renders the shared chrome and every page from window.SITE. */
(function () {
  "use strict";
  const S = window.SITE;
  const L = window.SiteLib;
  const { esc } = L;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const view = () => document.getElementById("view");
  const page = document.body.getAttribute("data-page") || "";
  const money = (n) => L.formatPrice(n, S.brand.currency);
  const cents = (c) => money(c / 100);
  const params = () => new URLSearchParams(location.search);
  const pdp = (id) => `product.html?id=${encodeURIComponent(id)}`;

  /* ---------- Storage (never throws: private mode / blocked storage) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  /* ---------- Cart state ---------- */
  let cart = L.parseCart(store.get("cw_cart"), S.products);
  let code = store.get("cw_code") || "";
  const saveCart = () => { store.set("cw_cart", JSON.stringify(cart)); refreshCart(); };
  const setCode = (c) => { code = c; c ? store.set("cw_code", c) : store.del("cw_code"); refreshCart(); };
  const lines = () => L.cartLines(cart, S.products);
  const totals = () => L.cartTotals(lines(), code, S.checkout.discounts);

  /* ---------- Product visuals ---------- */
  function media(p, cls) {
    const img = L.safeUrl(p.image);
    if (img) return `<img class="${cls || ""}" src="${esc(img)}" alt="${esc(p.title)}" loading="lazy">`;
    const c = p.color || ["#e50069", "#ff7eb3"];
    return `<div class="cover cover-${esc(p.type)} ${cls || ""}" style="--c1:${esc(c[0])};--c2:${esc(c[1])}" role="img" aria-label="${esc(p.title)}">
      <span class="cover-type">${esc(L.TYPE_LABEL[p.type] || "")}</span>
      <span class="cover-title">${esc(p.title.split(":")[0])}</span></div>`;
  }

  const priceHtml = (p) => {
    const off = L.discountPercent(p);
    return `<span class="price"><strong>${money(p.price)}</strong>${off ? ` <s>${money(p.compareAt)}</s> <em>Save ${off}%</em>` : ""}</span>`;
  };

  const stars = (value) =>
    `<span class="stars" role="img" aria-label="${value} out of 5 stars" style="--pct:${Math.max(0, Math.min(100, (value / 5) * 100))}%">★★★★★</span>`;

  const fmtDate = (iso) => {
    const d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  };

  function card(p) {
    return `<article class="card">
      <a class="thumb" href="${pdp(p.id)}" aria-label="${esc(p.title)}">${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}${media(p)}</a>
      <h2><a href="${pdp(p.id)}">${esc(p.title)}</a></h2>
      ${priceHtml(p)}
      <button class="btn" type="button" data-add="${esc(p.id)}">Add to cart</button></article>`;
  }

  /* ---------- Chrome ---------- */
  const icon = {
    cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  };

  function renderChrome() {
    const here = location.pathname.split("/").pop() || "index.html";
    const nav = S.nav.map((n) => `<li><a href="${esc(n.href)}"${n.href === here ? ' aria-current="page"' : ""}>${esc(n.label)}</a></li>`).join("");
    document.getElementById("site-header").innerHTML = `
      <a class="skip" href="#main">Skip to content</a>
      ${S.announcement ? `<div class="announce">${esc(S.announcement)}</div>` : ""}
      <div class="container bar">
        <a class="logo" href="index.html" aria-label="${esc(S.brand.name)} home">${esc(S.brand.name)}</a>
        <nav id="primary-nav" aria-label="Primary"><ul>${nav}</ul></nav>
        <button class="cart-btn" type="button" data-open-cart aria-label="Open cart">${icon.cart}<span class="cart-count" data-cart-count>0</span></button>
        <button class="menu-btn" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="Menu"><span></span><span></span><span></span></button>
      </div>`;
    const social = Object.keys(S.brand.social || {}).filter((k) => L.safeUrl(S.brand.social[k]))
      .map((k) => `<a href="${esc(S.brand.social[k])}" rel="noopener" target="_blank">${esc(k[0].toUpperCase() + k.slice(1))}</a>`).join("");
    document.getElementById("site-footer").innerHTML = `
      <div class="container foot">
        <div><a class="logo" href="index.html">${esc(S.brand.name)}</a><p>${esc(S.brand.tagline)}</p>
        <p class="small">Need help accessing your purchase? Email <a href="mailto:${esc(S.brand.supportEmail)}">${esc(S.brand.supportEmail)}</a></p></div>
        <div class="foot-links">${social}</div>
      </div>
      <div class="container legal">&copy; ${new Date().getFullYear()} ${esc(S.brand.name)}. All rights reserved. &middot; <a href="terms.html">Terms &amp; Conditions</a> &middot; <a href="privacy.html">Privacy Policy</a></div>`;

    const btn = $(".menu-btn"), navEl = $("#primary-nav");
    btn.addEventListener("click", () => btn.setAttribute("aria-expanded", String(navEl.classList.toggle("open"))));

    document.body.insertAdjacentHTML("beforeend", `
      <div class="overlay" data-close hidden></div>
      <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Shopping cart" hidden></aside>`);
    document.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add) { cart = L.cartAdd(cart, add.getAttribute("data-add"), add.getAttribute("data-qty") || 1); saveCart(); openDrawer(); }
      if (e.target.closest("[data-open-cart]")) openDrawer();
      if (e.target.closest("[data-close]")) closeLayers();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLayers(); });
    wireQty(document);
  }

  /* ---------- Cart drawer ---------- */
  let lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    $("#drawer").hidden = false;
    $(".overlay").hidden = false;
    document.body.classList.add("locked");
    renderDrawer();
    const c = $("#drawer .x"); if (c) c.focus();
  }
  function closeLayers() {
    const open = !$("#drawer").hidden || ($(".popup") && !$(".popup").hidden);
    if (!open) return;
    $("#drawer").hidden = true;
    const pop = $(".popup");
    if (pop && !pop.hidden) store.set("cw_popup", store.get("cw_popup") || "dismissed");
    if (pop) pop.hidden = true;
    $(".overlay").hidden = true;
    document.body.classList.remove("locked");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function lineRow(l, compact) {
    const p = l.product;
    return `<li class="line">
      <a class="line-img" href="${pdp(p.id)}">${media(p)}</a>
      <div class="line-body"><a href="${pdp(p.id)}">${esc(p.title)}</a><span class="muted">${money(p.price)}</span>
        <div class="qty" data-line="${esc(p.id)}">
          <button type="button" data-dec aria-label="Decrease quantity of ${esc(p.title)}">&minus;</button>
          <input type="number" min="0" max="${L.MAX_QTY}" value="${l.qty}" aria-label="Quantity of ${esc(p.title)}" data-qty-input>
          <button type="button" data-inc aria-label="Increase quantity of ${esc(p.title)}">+</button>
          <button type="button" class="link" data-remove>${compact ? "Remove" : "Remove item"}</button></div></div>
      <strong class="line-total">${cents(l.cents)}</strong></li>`;
  }

  function totalsHtml(t) {
    return `<dl class="totals"><div><dt>Subtotal</dt><dd>${cents(t.subtotal)}</dd></div>
      ${t.discount ? `<div class="disc"><dt>Discount (${esc(t.code)})</dt><dd>&minus;${cents(t.discount)}</dd></div>` : ""}
      <div class="grand"><dt>Total</dt><dd>${cents(t.total)}</dd></div></dl>
      <p class="muted small">Taxes are calculated at checkout.</p>`;
  }

  function renderDrawer() {
    const l = lines(), d = $("#drawer");
    d.innerHTML = `<div class="drawer-head"><h2>Your cart</h2><button type="button" class="x" data-close aria-label="Close cart">&times;</button></div>
      ${l.length ? `<ul class="lines">${l.map((x) => lineRow(x, true)).join("")}</ul>${totalsHtml(totals())}
        <a class="btn btn-block" href="cart.html">View my cart</a>
        <a class="btn btn-dark btn-block" href="cart.html#checkout">Go to checkout</a>`
        : `<p>Your cart is currently empty!</p><a class="btn btn-block" href="index.html" data-close>Start shopping</a>`}`;
  }

  function wireQty(root) {
    root.addEventListener("click", (e) => {
      const wrap = e.target.closest("[data-line]");
      if (!wrap) return;
      const id = wrap.getAttribute("data-line");
      const cur = (cart.find((i) => i.id === id) || { qty: 0 }).qty;
      if (e.target.closest("[data-inc]")) cart = L.cartSet(cart, id, cur + 1);
      else if (e.target.closest("[data-dec]")) cart = L.cartSet(cart, id, cur - 1);
      else if (e.target.closest("[data-remove]")) cart = L.cartSet(cart, id, 0);
      else return;
      saveCart();
    });
    root.addEventListener("change", (e) => {
      const input = e.target.closest("[data-qty-input]");
      if (!input) return;
      cart = L.cartSet(cart, input.closest("[data-line]").getAttribute("data-line"), input.value);
      saveCart();
    });
  }

  function refreshCart() {
    const n = L.cartCount(cart);
    $$("[data-cart-count]").forEach((el) => { el.textContent = n; el.hidden = n === 0; });
    if (!$("#drawer").hidden) renderDrawer();
    if (page === "cart") renderCart();
  }

  /* ---------- Newsletter popup ---------- */
  function setupPopup() {
    const cfg = S.popup;
    if (!cfg || !cfg.enabled || store.get("cw_popup") || page === "success") return;
    const open = () => {
      if (store.get("cw_popup") || !$("#drawer").hidden) return;
      lastFocus = document.activeElement;
      const el = $(".popup");
      el.hidden = false; $(".overlay").hidden = false; document.body.classList.add("locked");
      $("input", el).focus();
    };
    document.body.insertAdjacentHTML("beforeend", `
      <div class="popup" role="dialog" aria-modal="true" aria-labelledby="popup-title" hidden>
        <button type="button" class="x" data-close data-dismiss aria-label="Close">&times;</button>
        <div data-step="form"><h2 id="popup-title">${esc(cfg.title)}</h2><p>${esc(cfg.text)}</p>
          <form data-form="newsletter" data-reward novalidate>
            <label for="pp-name">First name</label><input id="pp-name" name="name" autocomplete="given-name" required>
            <label for="pp-email">Email</label><input id="pp-email" name="email" type="email" autocomplete="email" required>
            <button class="btn btn-block" type="submit">${esc(cfg.button)}</button><p class="form-msg" role="status" aria-live="polite"></p></form></div>
        <div data-step="done" hidden><h2>Success!</h2><p>Here's your discount code:</p><p class="code">${esc(cfg.code)}</p>
          <button type="button" class="btn btn-block" data-copy="${esc(cfg.code)}">Copy code</button>
          <p class="muted small">It will be applied automatically in your cart.</p></div></div>`);
    handleForm($(".popup form"));
    setTimeout(open, Math.max(0, cfg.delaySeconds) * 1000);
    window.__openPopup = open;
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (!c) return;
    const text = c.getAttribute("data-copy");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      () => { c.textContent = "Copied!"; }, () => { c.textContent = "Select and copy the code above"; });
  });

  /* ---------- Forms ---------- */
  function handleForm(form) {
    const msg = $(".form-msg", form);
    const say = (t, ok) => { msg.textContent = t; msg.className = "form-msg " + (ok ? "ok" : "err"); };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = String(v).trim(); });
      data.name = data.name || [data.first, data.last].filter(Boolean).join(" ");
      const kind = form.dataset.form;
      if (!L.isEmail(data.email)) return say("Please enter a valid email address.", false);
      if (kind === "contact" && (!data.name || !data.message)) return say("Please fill in every required field.", false);
      const done = () => {
        if (form.hasAttribute("data-reward")) {
          store.set("cw_popup", "done");
          if (S.popup && S.popup.code) setCode(S.popup.code);
          $('.popup [data-step="form"]').hidden = true; $('.popup [data-step="done"]').hidden = false;
        } else { form.reset(); say(kind === "contact" ? "Thank you! We'll be in touch soon." : "Thanks for subscribing!", true); }
      };
      if (!S.brand.formEndpoint) {
        const subject = kind === "contact" ? "Website message from " + data.name : "Newsletter signup";
        const body = kind === "contact" ? `${data.message}\n\n${data.name} <${data.email}>` : `Please add me to the list: ${data.email}`;
        done();
        location.href = L.mailtoHref(S.brand.email, subject, body);
        return;
      }
      say("Sending...", true);
      fetch(S.brand.formEndpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
        .then((r) => { if (!r.ok) throw new Error(r.status); done(); })
        .catch(() => say("Something went wrong. Please try again or email " + S.brand.email + ".", false));
    });
  }

  /* ---------- Pagination ---------- */
  function pager(pg, hrefFor) {
    if (pg.pages < 2) return "";
    const items = [];
    for (let i = 1; i <= pg.pages; i++) {
      items.push(i === pg.page ? `<span aria-current="page">${i}</span>` : `<a href="${esc(hrefFor(i))}" data-page="${i}">${i}</a>`);
    }
    if (pg.page < pg.pages) items.push(`<a href="${esc(hrefFor(pg.page + 1))}" data-page="${pg.page + 1}">Next Page</a>`);
    return `<nav class="pager" aria-label="Pagination">${items.join("")}</nav>`;
  }

  /* ---------- Pages ---------- */
  function renderShop() {
    const q = params();
    const cats = L.allCategories(S.products);
    const prices = S.products.map((p) => p.price);
    const lo = Math.floor(Math.min.apply(null, prices)), hi = Math.ceil(Math.max.apply(null, prices));
    const initialCats = (q.get("cat") || "").split(",").filter(Boolean);
    view().innerHTML = `
      <header class="page-head"><div class="container"><h1>${esc(S.shop.title)}</h1><p>${esc(S.shop.intro)}</p></div></header>
      <div class="container shop">
        <button class="btn btn-ghost filter-toggle" type="button" aria-expanded="false" aria-controls="filters">Filters</button>
        <form id="filters" class="filters" role="search" novalidate>
          <div class="searchbox"><label class="sr" for="f-q">Search products</label><input id="f-q" type="search" name="q" placeholder="Search products…" value="${esc(q.get("q") || "")}"><button class="btn btn-icon" type="submit" aria-label="Search">${icon.search}</button></div>
          <fieldset><legend>Price</legend><div class="price-range"><label class="sr" for="f-min">Minimum price</label><input id="f-min" type="number" name="min" min="0" placeholder="$${lo}" value="${esc(q.get("min") || "")}"><span>to</span><label class="sr" for="f-max">Maximum price</label><input id="f-max" type="number" name="max" min="0" placeholder="$${hi}" value="${esc(q.get("max") || "")}"></div></fieldset>
          <fieldset><legend>Categories</legend>${cats.map((c) => `<label class="check"><input type="checkbox" name="cat" value="${esc(c)}"${initialCats.indexOf(c) > -1 ? " checked" : ""}> ${esc(c)}</label>`).join("")}</fieldset>
          <button type="button" class="link" data-reset>Clear all filters</button>
        </form>
        <section aria-live="polite"><div class="toolbar"><p id="count" class="muted"></p>
          <label class="sort">Sort <select id="f-sort" name="sort"><option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="title">Title A–Z</option></select></label></div>
          <div id="results"></div></section></div>`;
    const form = $("#filters"), sortEl = $("#f-sort");
    sortEl.value = ["featured", "price-asc", "price-desc", "title"].indexOf(q.get("sort")) > -1 ? q.get("sort") : "featured";
    let pageNo = q.get("page") || 1;

    function state() {
      const fd = new FormData(form);
      return { q: fd.get("q") || "", min: fd.get("min") || "", max: fd.get("max") || "", cats: fd.getAll("cat"), sort: sortEl.value };
    }
    function qs(s, p) {
      const u = new URLSearchParams();
      if (s.q) u.set("q", s.q);
      if (s.min) u.set("min", s.min);
      if (s.max) u.set("max", s.max);
      if (s.cats.length) u.set("cat", s.cats.join(","));
      if (s.sort !== "featured") u.set("sort", s.sort);
      if (p > 1) u.set("page", p);
      const str = u.toString();
      return str ? "?" + str : location.pathname.split("/").pop() || "index.html";
    }
    function draw() {
      const s = state();
      const found = L.sortProducts(L.filterProducts(S.products, s), s.sort);
      const pg = L.paginate(found, pageNo, S.shop.perPage);
      pageNo = pg.page;
      try { history.replaceState(null, "", qs(s, pg.page)); } catch (e) { /* file:// */ }
      $("#count").textContent = found.length === 1 ? "Showing the only result" : `Showing ${found.length} results`;
      $("#results").innerHTML = found.length
        ? `<div class="grid">${pg.items.map(card).join("")}</div>${pager(pg, (i) => qs(s, i))}`
        : '<p class="empty">No products match your filters. <button class="link" type="button" data-reset>Clear filters</button></p>';
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); pageNo = 1; draw(); });
    form.addEventListener("change", () => { pageNo = 1; draw(); });
    sortEl.addEventListener("change", () => { pageNo = 1; draw(); });
    view().addEventListener("click", (e) => {
      if (e.target.closest("[data-reset]")) { form.reset(); $$("input", form).forEach((i) => { if (i.type === "checkbox") i.checked = false; else i.value = ""; }); pageNo = 1; draw(); }
      const a = e.target.closest(".pager a");
      if (a) { e.preventDefault(); pageNo = Number(a.getAttribute("data-page")); draw(); $(".shop").scrollIntoView(); }
    });
    const tgl = $(".filter-toggle");
    tgl.addEventListener("click", () => tgl.setAttribute("aria-expanded", String(form.classList.toggle("open"))));
    draw();
  }

  function reviewItem(r, withProduct) {
    const p = L.getProduct(S.products, r.productId);
    return `<li class="review"><div class="review-head"><strong>${esc(r.name)}</strong><span class="verified">Verified buyer</span></div>
      <div class="review-meta">${stars(r.rating)}${withProduct && p ? ` <a href="${pdp(p.id)}">${esc(p.title)}</a>` : ""}<time datetime="${esc(r.date)}">${esc(fmtDate(r.date))}</time></div>
      <p>${esc(r.text)}</p></li>`;
  }

  function summaryHtml(sum) {
    const rows = [5, 4, 3, 2, 1].map((s) => `<li><span>${s}★</span><div class="meter" role="img" aria-label="${sum.dist[s]}% gave ${s} stars"><i style="width:${sum.dist[s]}%"></i></div><span>${sum.dist[s]}%</span></li>`).join("");
    return `<div class="summary"><div class="score"><strong>${sum.average.toFixed(1)}</strong>${stars(sum.average)}<span class="muted">Based on ${sum.count.toLocaleString("en-US")} review${sum.count === 1 ? "" : "s"}</span></div><ul class="dist">${rows}</ul></div>`;
  }

  function renderProduct() {
    const id = params().get("id");
    const p = L.getProduct(S.products, id);
    if (!p) {
      document.title = "Product not found | " + S.brand.name;
      view().innerHTML = '<div class="narrow"><h1>Product not found</h1><p><a class="btn" href="index.html">Back to the shop</a></p></div>';
      return;
    }
    document.title = `${p.title} | ${S.brand.name}`;
    const meta = $('meta[name="description"]'); if (meta) meta.setAttribute("content", p.summary);
    const revs = L.sortReviews(L.filterReviews(S.reviews, { productId: p.id }), "recent");
    const ld = { "@context": "https://schema.org", "@type": "Product", name: p.title, description: p.summary,
      offers: { "@type": "Offer", price: p.price, priceCurrency: S.brand.currency, availability: "https://schema.org/InStock" } };
    if (revs.length) { const s = L.reviewSummary(revs); ld.aggregateRating = { "@type": "AggregateRating", ratingValue: s.average, reviewCount: s.count }; }
    const tag = document.createElement("script"); tag.type = "application/ld+json";
    tag.textContent = JSON.stringify(ld).replace(/</g, "\\u003c"); document.head.appendChild(tag);

    const buy = L.safeUrl(p.checkoutUrl);
    const related = S.products.filter((o) => o.id !== p.id && o.type === p.type).slice(0, 3);
    view().innerHTML = `
      <div class="container product">
        <div class="product-media">${media(p)}</div>
        <div class="product-info"><h1>${esc(p.title)}</h1><p class="price-lg">${priceHtml(p)}</p><p>${esc(p.summary)}</p>
          <div class="buy"><label class="qty-field"><span class="sr">Quantity</span><input id="qty" type="number" min="1" max="${L.MAX_QTY}" value="1"></label>
            <button class="btn" type="button" id="add-main">Add to cart</button>
            ${buy ? `<a class="btn btn-dark" href="${esc(buy)}" rel="noopener">Buy now</a>` : ""}</div>
          <p class="cats">Category: ${L.categoriesOf(p).map((c) => `<a href="index.html?cat=${encodeURIComponent(c)}">${esc(c)}</a>`).join(", ")}</p></div></div>
      <div class="container tabs-wrap">
        <div class="tabs" role="tablist" aria-label="Product details">
          <button role="tab" id="t-desc" aria-controls="p-desc" aria-selected="true">Description</button>
          <button role="tab" id="t-info" aria-controls="p-info" aria-selected="false" tabindex="-1">Additional information</button>
          <button role="tab" id="t-rev" aria-controls="p-rev" aria-selected="false" tabindex="-1">Reviews (${revs.length})</button></div>
        <div role="tabpanel" id="p-desc" aria-labelledby="t-desc"><h2>What's Included:</h2>${p.description.map((d) => `<p>${esc(d)}</p>`).join("")}<ul class="ticks">${p.included.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
        <div role="tabpanel" id="p-info" aria-labelledby="t-info" hidden><table class="info">${Object.keys(p.info || {}).map((k) => `<tr><th scope="row">${esc(k)}</th><td>${esc(p.info[k])}</td></tr>`).join("")}</table></div>
        <div role="tabpanel" id="p-rev" aria-labelledby="t-rev" hidden>${revs.length ? summaryHtml(L.reviewSummary(revs)) + `<ul class="reviews">${revs.map((r) => reviewItem(r, false)).join("")}</ul>` : "<p>There are no reviews yet.</p>"}</div></div>
      ${related.length ? `<div class="container related"><h2>You may also like</h2><div class="grid">${related.map(card).join("")}</div></div>` : ""}`;

    $("#add-main").addEventListener("click", () => {
      const qty = Math.max(1, Math.min(L.MAX_QTY, parseInt($("#qty").value, 10) || 1));
      cart = L.cartAdd(cart, p.id, qty); saveCart(); openDrawer();
    });
    const tabs = $$('[role="tab"]');
    const select = (t) => tabs.forEach((x) => {
      const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
    });
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
        if (n === null) return;
        const nt = tabs[(n + tabs.length) % tabs.length]; select(nt); nt.focus();
      });
    });
  }

  function renderCart() {
    const l = lines(), t = totals();
    const codeMsg = code && !t.code ? '<p class="form-msg err">That code is not valid.</p>' : t.code ? `<p class="form-msg ok">Code ${esc(t.code)} applied: ${t.percent}% off.</p>` : "";
    view().innerHTML = `<div class="container cart-page"><h1>Cart</h1>
      ${l.length ? `<div class="cart-grid"><ul class="lines">${l.map((x) => lineRow(x, false)).join("")}</ul>
        <div class="cart-side"><form class="coupon" data-coupon novalidate><label for="cp">Discount code</label><div><input id="cp" name="code" value="${esc(code)}" autocomplete="off"><button class="btn btn-dark" type="submit">Apply</button></div>${codeMsg}</form>
          ${totalsHtml(t)}<button class="btn btn-block" id="checkout" type="button">Go to checkout</button><div id="checkout-msg" role="status" aria-live="polite"></div></div></div>`
        : '<p>Your cart is currently empty!</p><p><a class="btn" href="index.html">Start shopping</a></p>'}</div>`;
    const f = $("[data-coupon]");
    if (f) f.addEventListener("submit", (e) => { e.preventDefault(); setCode($("#cp").value.trim().toUpperCase()); });
    const b = $("#checkout"); if (b) b.addEventListener("click", checkout);
  }

  /* Server checkout if configured; otherwise per-item links or an emailed order. */
  function checkout() {
    const msg = $("#checkout-msg"), btn = $("#checkout");
    const l = lines(), t = totals();
    if (S.checkout.endpoint) {
      btn.disabled = true; msg.textContent = "Taking you to secure checkout…";
      fetch(S.checkout.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart, code: t.code }) })
        .then((r) => r.json().then((j) => { if (!r.ok || !L.safeUrl(j.url)) throw new Error(j.error || r.status); return j; }))
        .then((j) => { location.href = j.url; })
        .catch(() => { btn.disabled = false; msg.innerHTML = `<p class="form-msg err">Checkout is unavailable right now. Please try again or email <a href="mailto:${esc(S.brand.email)}">${esc(S.brand.email)}</a>.</p>`; });
      return;
    }
    const order = l.map((x) => `${x.qty} x ${x.product.title} (${money(x.product.price)})`).join("\n") + `\nTotal: ${cents(t.total)}${t.code ? " (code " + t.code + ")" : ""}`;
    const pay = l.filter((x) => L.safeUrl(x.product.checkoutUrl)).map((x) => `<li><a class="btn btn-sm" href="${esc(x.product.checkoutUrl)}" rel="noopener">Pay for ${esc(x.product.title)}</a></li>`).join("");
    msg.innerHTML = `<div class="notice"><p><strong>Complete your order</strong></p>${pay ? `<ul class="pay">${pay}</ul>` : ""}
      <p><a href="${esc(L.mailtoHref(S.brand.email, "Order request", order))}">Email my order</a> and we will send a secure payment link.</p></div>`;
  }

  function renderReviews() {
    const sum = L.reviewSummary(S.reviews, S.reviewStats);
    view().innerHTML = `<div class="container narrow-lg"><h1 class="center">Customer Ratings and Reviews</h1>${summaryHtml(sum)}
      <form class="rv-search" role="search" novalidate><label class="sr" for="rq">Search customer reviews</label><input id="rq" type="search" placeholder="Search customer reviews"><button class="btn btn-dark" type="submit">Search</button></form>
      <div class="toolbar"><p class="muted" id="rv-count"></p><label class="sort">Sort <select id="rs"><option value="recent">Most Recent</option><option value="helpful">Most Helpful</option><option value="high">Highest rating</option><option value="low">Lowest rating</option></select></label></div>
      <div id="rv-list" aria-live="polite"></div></div>`;
    let pageNo = 1;
    const draw = () => {
      const found = L.sortReviews(L.filterReviews(S.reviews, { q: $("#rq").value }), $("#rs").value);
      const pg = L.paginate(found, pageNo, 10); pageNo = pg.page;
      const from = found.length ? (pg.page - 1) * 10 + 1 : 0;
      $("#rv-count").textContent = `${from}-${from + pg.items.length - (found.length ? 1 : 0)} of ${found.length} reviews`;
      $("#rv-list").innerHTML = found.length ? `<ul class="reviews">${pg.items.map((r) => reviewItem(r, true)).join("")}</ul>${pager(pg, () => "#")}` : '<p class="empty">No reviews match your search.</p>';
    };
    $(".rv-search").addEventListener("submit", (e) => { e.preventDefault(); pageNo = 1; draw(); });
    $("#rq").addEventListener("input", () => { pageNo = 1; draw(); });
    $("#rs").addEventListener("change", () => { pageNo = 1; draw(); });
    $("#rv-list").addEventListener("click", (e) => { const a = e.target.closest(".pager a"); if (a) { e.preventDefault(); pageNo = Number(a.getAttribute("data-page")); draw(); window.scrollTo({ top: 0 }); } });
    draw();
  }

  function renderFree() {
    const f = S.free;
    view().innerHTML = `<header class="page-head"><div class="container"><h1>${esc(f.title)}</h1><p>${esc(f.intro)}</p></div></header>
      <div class="container"><div class="grid free-grid">${f.items.map((it) => `<article class="card free"><h2>${esc(it.title)}</h2><p>${esc(it.text)}</p>
        ${it.popup ? `<button class="btn" type="button" data-signup>${esc(it.cta)}</button>` : `<a class="btn" href="${esc(L.safeUrl(it.url) || "contact.html")}" rel="noopener" target="_blank">${esc(it.cta)}</a>`}</article>`).join("")}</div></div>`;
    $$("[data-signup]").forEach((b) => b.addEventListener("click", () => {
      store.del("cw_popup"); if (!$(".popup")) setupPopup(); (window.__openPopup || function () {})();
    }));
  }

  function renderAbout() {
    const a = S.about, ph = L.safeUrl(a.photo);
    view().innerHTML = `<div class="container narrow-lg about"><div><h1>${esc(a.headline)}</h1>${a.long.map((t) => `<p>${esc(t)}</p>`).join("")}<p><a class="btn" href="index.html">Shop courses &amp; books</a></p></div>
      ${ph ? `<img src="${esc(ph)}" alt="${esc(S.brand.name)}" loading="lazy">` : ""}</div>`;
  }

  function renderContact() {
    const pid = params().get("product"), p = pid && L.getProduct(S.products, pid);
    view().innerHTML = `<div class="container narrow-lg"><h1>Have a question for ${esc(S.brand.name)}?</h1>
      <form class="form" data-form="contact" novalidate>
        <div class="two"><div><label for="c-first">First name <b>*</b></label><input id="c-first" name="first" autocomplete="given-name" required></div><div><label for="c-last">Last name</label><input id="c-last" name="last" autocomplete="family-name"></div></div>
        <label for="c-email">Email <b>*</b></label><input id="c-email" name="email" type="email" autocomplete="email" required>
        <label for="c-msg">Message <b>*</b></label><textarea id="c-msg" name="message" rows="6" required>${p ? "I have a question about: " + esc(p.title) : ""}</textarea>
        <button class="btn" type="submit">Submit</button><p class="form-msg" role="status" aria-live="polite"></p></form>
      <p class="muted">Need help accessing your courses? Please email us at <a href="mailto:${esc(S.brand.supportEmail)}">${esc(S.brand.supportEmail)}</a>.</p></div>`;
  }

  function renderSuccess() {
    cart = []; saveCart(); setCode("");
    view().innerHTML = `<div class="narrow center"><h1>Thank you!</h1><p>Your order is confirmed. A receipt and your access details are on their way to your inbox.</p><p class="muted">Need help? Email <a href="mailto:${esc(S.brand.supportEmail)}">${esc(S.brand.supportEmail)}</a>.</p><p><a class="btn" href="index.html">Keep shopping</a></p></div>`;
  }

  /* ---------- Boot ---------- */
  renderChrome();
  const pages = { shop: renderShop, product: renderProduct, cart: renderCart, reviews: renderReviews, free: renderFree, about: renderAbout, contact: renderContact, success: renderSuccess };
  if (pages[page] && view()) pages[page]();
  $$("form[data-form]").forEach(handleForm);
  if (page === "shop" || page === "product" || page === "free") setupPopup();
  refreshCart();
})();
