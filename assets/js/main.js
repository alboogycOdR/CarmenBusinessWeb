/* Renders shared chrome (header/footer) and page sections from window.SITE. */
(function () {
  "use strict";
  var S = window.SITE;
  var L = window.SiteLib;
  var esc = L.esc;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var mount = function (id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return el;
  };
  var page = document.body.getAttribute("data-page") || "";
  var price = function (n) { return L.formatPrice(n, S.brand.currency); };

  /* ---------- Shared pieces ---------- */
  function renderHeader() {
    var here = location.pathname.split("/").pop() || "index.html";
    var links = S.nav.map(function (n) {
      var cur = n.href === here ? ' aria-current="page"' : "";
      return '<li><a href="' + esc(n.href) + '"' + cur + ">" + esc(n.label) + "</a></li>";
    }).join("");
    mount("site-header",
      '<a class="skip" href="#main">Skip to content</a>' +
      '<div class="container bar">' +
        '<a class="logo" href="index.html">' + esc(S.brand.name) + "</a>" +
        '<button class="menu-btn" aria-expanded="false" aria-controls="primary-nav" aria-label="Menu"><span></span><span></span><span></span></button>' +
        '<nav id="primary-nav" aria-label="Primary"><ul>' + links + "</ul></nav>" +
      "</div>");
    var btn = $(".menu-btn");
    var nav = $("#primary-nav");
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }

  function socialLinks() {
    return Object.keys(S.brand.social || {}).filter(function (k) {
      return L.safeUrl(S.brand.social[k]);
    }).map(function (k) {
      return '<a href="' + esc(S.brand.social[k]) + '" rel="noopener" target="_blank">' +
        esc(k.charAt(0).toUpperCase() + k.slice(1)) + "</a>";
    }).join("");
  }

  function renderFooter() {
    var links = S.nav.map(function (n) {
      return '<a href="' + esc(n.href) + '">' + esc(n.label) + "</a>";
    }).join("");
    mount("site-footer",
      '<div class="container foot">' +
        '<div><a class="logo" href="index.html">' + esc(S.brand.name) + "</a>" +
        "<p>" + esc(S.brand.tagline) + "</p></div>" +
        '<div class="foot-links" aria-label="Footer">' + links + "</div>" +
        '<div class="foot-links">' + socialLinks() + "</div>" +
      "</div>" +
      '<div class="container legal">&copy; ' + new Date().getFullYear() + " " +
      esc(S.brand.name) + ". All rights reserved.</div>");
  }

  /* ---------- Product UI ---------- */
  function cover(p, large) {
    var c = p.color || ["#2f4f46", "#6f9a86"];
    var cls = "cover cover-" + esc(p.type) + (large ? " cover-lg" : "");
    return '<div class="' + cls + '" style="--c1:' + esc(c[0]) + ";--c2:" + esc(c[1]) + '" role="img" aria-label="' + esc(p.title) + ' cover">' +
      '<span class="cover-type">' + esc(p.type) + "</span>" +
      '<span class="cover-title">' + esc(p.title) + "</span>" +
      '<span class="cover-sub">' + esc(p.subtitle || "") + "</span></div>";
  }

  function priceBlock(p) {
    var off = L.discountPercent(p);
    return '<p class="price"><strong>' + price(p.price) + "</strong>" +
      (off ? ' <s>' + price(p.compareAt) + '</s> <span class="off">Save ' + off + "%</span>" : "") + "</p>";
  }

  function card(p) {
    return '<article class="card">' +
      '<a class="card-media" href="product.html?id=' + encodeURIComponent(p.id) + '" aria-label="' + esc(p.title) + '">' +
        (p.badge ? '<span class="badge">' + esc(p.badge) + "</span>" : "") + cover(p) + "</a>" +
      '<div class="card-body"><h3><a href="product.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.title) + "</a></h3>" +
      "<p>" + esc(p.summary) + "</p>" + priceBlock(p) +
      '<a class="btn btn-sm" href="product.html?id=' + encodeURIComponent(p.id) + '">Learn more</a></div></article>';
  }

  function grid(items) {
    if (!items.length) return '<p class="empty">Nothing here yet. Check back soon.</p>';
    return '<div class="grid">' + items.map(card).join("") + "</div>";
  }

  function buyButton(p) {
    var url = L.safeUrl(p.checkoutUrl);
    if (!url) {
      return '<a class="btn btn-block" href="contact.html?product=' + encodeURIComponent(p.id) + '">Coming soon: get notified</a>';
    }
    return '<a class="btn btn-block" href="' + esc(url) + '" rel="noopener">Buy now &middot; ' + price(p.price) + "</a>" +
      '<p class="secure">Secure checkout on our payment partner\'s site.</p>';
  }

  /* ---------- Sections ---------- */
  function renderHero() {
    var h = S.hero;
    var f = L.getProduct(S.products, h.featuredId) || S.products[0];
    mount("hero",
      '<div class="container hero-grid">' +
        '<div><p class="eyebrow">' + esc(h.eyebrow) + "</p><h1>" + esc(h.title) + "</h1>" +
        '<p class="lead">' + esc(h.lead) + "</p>" +
        '<div class="actions"><a class="btn" href="' + esc(h.primary.href) + '">' + esc(h.primary.label) + "</a>" +
        '<a class="btn btn-ghost" href="' + esc(h.secondary.href) + '">' + esc(h.secondary.label) + "</a></div></div>" +
        (f ? '<a class="hero-feature" href="product.html?id=' + encodeURIComponent(f.id) + '" aria-label="' + esc(f.title) + '">' + cover(f, true) + "</a>" : "") +
      "</div>");
  }

  function section(title, intro, body, more) {
    return '<div class="container"><div class="section-head"><h2>' + esc(title) + "</h2>" +
      (intro ? "<p>" + esc(intro) + "</p>" : "") + "</div>" + body +
      (more ? '<p class="more"><a class="btn btn-ghost" href="' + esc(more.href) + '">' + esc(more.label) + "</a></p>" : "") + "</div>";
  }

  function renderHome() {
    renderHero();
    mount("home-courses", section("Courses", "Learn at your own pace, with lifetime access.",
      grid(L.filterProducts(S.products, "course").slice(0, 3)), { href: "courses.html", label: "All courses" }));
    mount("home-books", section("Books", "Read, reflect and put it into practice.",
      grid(L.filterProducts(S.products, "book").slice(0, 3)), { href: "books.html", label: "All books" }));
    var b = S.products.filter(function (p) { return p.type === "bundle"; })[0];
    if (b) {
      mount("home-bundle",
        '<div class="container bundle"><div>' + cover(b, true) + "</div><div><p class=\"eyebrow\">Best value</p><h2>" + esc(b.title) + "</h2>" +
        "<p>" + esc(b.summary) + "</p>" + priceBlock(b) +
        '<a class="btn" href="product.html?id=' + encodeURIComponent(b.id) + '">See what\'s inside</a></div></div>');
    }
    mount("home-about",
      '<div class="container about-teaser"><div><h2>' + esc(S.about.headline) + "</h2><p>" + esc(S.about.short) + "</p>" +
      '<a class="btn btn-ghost" href="about.html">My story</a></div>' + statsHtml() + "</div>");
    renderTestimonials();
    renderNewsletter();
  }

  function statsHtml() {
    return '<dl class="stats">' + S.about.stats.map(function (s) {
      return "<div><dt>" + esc(s.label) + "</dt><dd>" + esc(s.value) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function renderTestimonials() {
    mount("testimonials", section("Kind words", "",
      '<div class="quotes">' + S.testimonials.map(function (t) {
        return "<figure><blockquote>" + esc(t.quote) + "</blockquote><figcaption><strong>" +
          esc(t.name) + "</strong><span>" + esc(t.role) + "</span></figcaption></figure>";
      }).join("") + "</div>"));
  }

  function renderNewsletter() {
    mount("newsletter",
      '<div class="container news"><div><h2>' + esc(S.newsletter.title) + "</h2><p>" + esc(S.newsletter.text) + "</p></div>" +
      '<form class="form-inline" data-form="newsletter" novalidate>' +
      '<label class="sr" for="nl-email">Email address</label>' +
      '<input id="nl-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required>' +
      '<button class="btn" type="submit">Subscribe</button>' +
      '<p class="form-msg" role="status" aria-live="polite"></p></form></div>');
  }

  function renderCatalog(type, title, intro) {
    var tabs = [["all", "All"], ["course", "Courses"], ["book", "Books"], ["bundle", "Bundles"]];
    var current = type || new URLSearchParams(location.search).get("type") || "all";
    var el = mount("catalog",
      '<div class="container"><div class="section-head"><h1>' + esc(title) + "</h1><p>" + esc(intro) + "</p></div>" +
      (type ? "" : '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button role="tab" class="tab" data-type="' + t[0] + '" aria-selected="' + (t[0] === current) + '">' + t[1] + "</button>";
      }).join("") + "</div>") +
      '<div id="catalog-grid"></div></div>');
    function draw(t) { $("#catalog-grid", el).innerHTML = grid(L.filterProducts(S.products, t)); }
    draw(current);
    el.addEventListener("click", function (e) {
      var t = e.target.closest(".tab");
      if (!t) return;
      [].forEach.call(el.querySelectorAll(".tab"), function (b) { b.setAttribute("aria-selected", String(b === t)); });
      draw(t.getAttribute("data-type"));
    });
    renderNewsletter();
  }

  function renderProduct() {
    var id = new URLSearchParams(location.search).get("id");
    var p = L.getProduct(S.products, id);
    if (!p) {
      mount("product", '<div class="container narrow"><h1>Product not found</h1><p><a class="btn" href="shop.html">Back to the shop</a></p></div>');
      return;
    }
    document.title = p.title + " | " + S.brand.name;
    var meta = $('meta[name="description"]');
    if (meta) meta.setAttribute("content", p.summary);
    var ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", name: p.title, description: p.summary,
      offers: { "@type": "Offer", price: p.price, priceCurrency: S.brand.currency, availability: L.safeUrl(p.checkoutUrl) ? "https://schema.org/InStock" : "https://schema.org/PreOrder" },
    }).replace(/</g, "\\u003c");
    document.head.appendChild(ld);
    var others = S.products.filter(function (o) { return o.id !== p.id && o.type === p.type; }).slice(0, 3);
    mount("product",
      '<div class="container product">' +
        '<div class="product-media">' + cover(p, true) + "</div>" +
        '<div class="product-info"><p class="eyebrow">' + esc(p.type) + "</p><h1>" + esc(p.title) + "</h1>" +
        '<p class="lead">' + esc(p.subtitle || "") + "</p>" + priceBlock(p) + buyButton(p) +
        p.description.map(function (d) { return "<p>" + esc(d) + "</p>"; }).join("") +
        '<h2 class="h3">What\'s included</h2><ul class="ticks">' + p.features.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul></div>" +
      "</div>" +
      (others.length ? '<div class="container related"><h2>You may also like</h2>' + grid(others) + "</div>" : ""));
  }

  function renderAbout() {
    mount("about",
      '<div class="container narrow"><h1>' + esc(S.about.headline) + "</h1>" +
      S.about.long.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") + statsHtml() +
      '<p><a class="btn" href="courses.html">Start learning</a></p></div>');
    renderNewsletter();
  }

  function renderContact() {
    var pid = new URLSearchParams(location.search).get("product");
    var p = pid && L.getProduct(S.products, pid);
    mount("contact",
      '<div class="container narrow"><h1>Get in touch</h1>' +
      "<p>" + (p ? "Leave your details and we will email you when <strong>" + esc(p.title) + "</strong> is available." :
        "Questions about a course, a book or working together? Send a message.") + "</p>" +
      '<form class="form" data-form="contact" novalidate>' +
        '<label for="c-name">Name</label><input id="c-name" name="name" autocomplete="name" required>' +
        '<label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required>' +
        '<label for="c-msg">Message</label><textarea id="c-msg" name="message" rows="6" required>' + (p ? "Please notify me about: " + esc(p.title) : "") + "</textarea>" +
        '<button class="btn" type="submit">Send message</button><p class="form-msg" role="status" aria-live="polite"></p></form></div>');
  }

  /* ---------- Forms ---------- */
  function handleForm(form) {
    var msg = $(".form-msg", form);
    var say = function (t, ok) { msg.textContent = t; msg.className = "form-msg " + (ok ? "ok" : "err"); };
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
      if (!L.isEmail(data.email)) return say("Please enter a valid email address.", false);
      if (form.dataset.form === "contact" && (!data.name || !data.message)) return say("Please fill in every field.", false);
      var endpoint = S.brand.formEndpoint;
      if (!endpoint) {
        var kind = form.dataset.form === "contact" ? "Website message from " + data.name : "Newsletter signup";
        var body = form.dataset.form === "contact" ? data.message + "\n\n" + data.email : "Please add me to the list: " + data.email;
        location.href = L.mailtoHref(S.brand.email, kind, body);
        return say("Opening your email app to finish sending.", true);
      }
      say("Sending...", true);
      fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); form.reset(); say("Thank you! We'll be in touch.", true); })
        .catch(function () { say("Something went wrong. Please try again or email " + S.brand.email + ".", false); });
    });
  }

  /* ---------- Boot ---------- */
  renderHeader();
  renderFooter();
  var pages = {
    home: renderHome,
    courses: function () { renderCatalog("course", "Courses", "Self-paced programmes with lifetime access."); },
    books: function () { renderCatalog("book", "Books", "Ebooks, workbooks and guides you can read today."); },
    shop: function () { renderCatalog(null, "Shop", "Everything in one place."); },
    product: renderProduct,
    about: renderAbout,
    contact: renderContact,
  };
  if (pages[page]) pages[page]();
  [].forEach.call(document.querySelectorAll("form[data-form]"), handleForm);
})();
