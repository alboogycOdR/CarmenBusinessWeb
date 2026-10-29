/* Pure HTML templates shared by the browser (main.js) and the build
 * (scripts/build.mts), so pre-rendered product pages and the live view are
 * byte-for-byte the same markup. No DOM access, no globals beyond SiteLib.
 * Every interpolated value is escaped. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./lib.js"));
  else root.SiteRender = factory(root.SiteLib);
})(typeof self !== "undefined" ? self : this, function (L) {
  var esc = L.esc;

  var urls = {
    product: function (slug) { return "/product/" + encodeURIComponent(slug) + "/"; },
    category: function (name) { return "/?cat=" + encodeURIComponent(name); },
  };

  function money(amount, currency) { return L.formatPrice(amount, currency); }

  function media(p) {
    var img = p.image && L.safeUrl(p.image.src);
    if (img) {
      var srcset = p.image.srcset ? ' srcset="' + esc(p.image.srcset) + '" sizes="(max-width: 560px) 100vw, 33vw"' : "";
      var dims = p.image.width && p.image.height ? ' width="' + esc(p.image.width) + '" height="' + esc(p.image.height) + '"' : "";
      return '<img src="' + esc(img) + '"' + srcset + dims + ' alt="' + esc(p.image.alt || p.title) + '" loading="lazy" decoding="async">';
    }
    return mockup(p);
  }

  /* ---------- Product mockups ------------------------------------------------
   * Until real product photos are supplied (products.images), each product gets a
   * device composition in the style of the reference shop: a laptop for courses,
   * a 3D book for books, fanned printables for guides/templates, all of them for
   * bundles. Drawn as inline SVG from the product's own colours and title, on a
   * light tile. All text is escaped; ids are namespaced by the (validated) slug. */
  var HEX = /^#[0-9a-fA-F]{3,8}$/;

  function wrap(text, maxChars, maxLines) {
    var words = String(text).split(/\s+/).filter(Boolean), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + " " + words[i] : words[i];
      if (next.length > maxChars && line) { lines.push(line); line = words[i]; } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…"; }
    return lines;
  }

  function textBlock(lines, x, y, size, fill, anchor, weight) {
    return '<text x="' + x + '" y="' + y + '" fill="' + fill + '" font-family="Lora, Georgia, serif" font-weight="' + (weight || 600) +
      '" font-size="' + size + '" text-anchor="' + (anchor || "middle") + '">' +
      lines.map(function (l, i) { return '<tspan x="' + x + '" dy="' + (i ? size * 1.15 : 0) + '">' + esc(l) + "</tspan>"; }).join("") + "</text>";
  }

  function sheet(x, y, w, h, rot, accent) {
    var lines = "";
    for (var i = 0; i < 6; i++) lines += '<rect x="' + (x + 14) + '" y="' + (y + 46 + i * 18) + '" width="' + (w - 28 - (i % 3) * 18) + '" height="5" rx="2.5" fill="#e6e6ea"/>';
    return '<g transform="rotate(' + rot + " " + (x + w / 2) + " " + (y + h / 2) + ')">' +
      '<rect x="' + (x + 3) + '" y="' + (y + 5) + '" width="' + w + '" height="' + h + '" rx="4" fill="#000" opacity=".06"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#fff" stroke="#ececf0"/>' +
      '<rect x="' + (x + 14) + '" y="' + (y + 16) + '" width="' + (w * 0.55) + '" height="12" rx="3" fill="' + accent + '"/>' + lines + "</g>";
  }

  function laptop(x, y, w, gid, title) {
    var h = w * 0.62, sx = x + w * 0.035, sy = y + w * 0.035, sw = w * 0.93, sh = h - w * 0.07;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + w * 0.03 + '" fill="#1d1d21"/>' +
      '<rect x="' + sx + '" y="' + sy + '" width="' + sw + '" height="' + sh + '" rx="3" fill="url(#' + gid + ')"/>' +
      '<rect x="' + sx + '" y="' + sy + '" width="' + sw + '" height="' + sh * 0.45 + '" rx="3" fill="#fff" opacity=".10"/>' +
      textBlock(wrap(title, 18, 2), x + w / 2, sy + sh * 0.46, w * 0.068, "#fff") +
      '<circle cx="' + (sx + sw / 2) + '" cy="' + (sy + sh * 0.8) + '" r="' + w * 0.04 + '" fill="#fff" opacity=".9"/>' +
      '<path d="M' + (sx + sw / 2 - w * 0.012) + " " + (sy + sh * 0.8 - w * 0.02) + "l" + w * 0.032 + " " + w * 0.02 + "l-" + w * 0.032 + " " + w * 0.02 + 'z" fill="#1d1d21"/>' +
      '<path d="M' + (x - w * 0.08) + " " + (y + h) + "H" + (x + w * 1.08) + "l-" + w * 0.035 + " " + w * 0.045 + "H" + (x - w * 0.045) + 'z" fill="#d7d7dd"/>' +
      '<rect x="' + (x + w * 0.42) + '" y="' + (y + h) + '" width="' + w * 0.16 + '" height="' + w * 0.014 + '" rx="2" fill="#b9b9c2"/>';
  }

  function phone(x, y, w, gid) {
    var h = w * 1.95, bars = "";
    for (var i = 0; i < 3; i++) bars += '<rect x="' + (x + w * 0.2) + '" y="' + (y + h * (0.52 + i * 0.11)) + '" width="' + w * (0.6 - i * 0.12) + '" height="' + w * 0.07 + '" rx="2" fill="#fff" opacity=".85"/>';
    return '<rect x="' + (x + 3) + '" y="' + (y + 5) + '" width="' + w + '" height="' + h + '" rx="' + w * 0.16 + '" fill="#000" opacity=".08"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + w * 0.16 + '" fill="#1d1d21"/>' +
      '<rect x="' + (x + w * 0.07) + '" y="' + (y + w * 0.12) + '" width="' + w * 0.86 + '" height="' + (h - w * 0.24) + '" rx="' + w * 0.1 + '" fill="url(#' + gid + ')" opacity=".92"/>' +
      '<circle cx="' + (x + w / 2) + '" cy="' + (y + h * 0.3) + '" r="' + w * 0.17 + '" fill="#fff" opacity=".9"/>' + bars;
  }

  function book(x, y, w, gid, title, label) {
    var h = w * 1.42, spine = w * 0.09;
    return '<rect x="' + (x + 6) + '" y="' + (y + 8) + '" width="' + w + '" height="' + h + '" rx="4" fill="#000" opacity=".12"/>' +
      '<rect x="' + (x + w - 4) + '" y="' + (y + 5) + '" width="10" height="' + (h - 10) + '" fill="#f4f0e8" stroke="#e6e0d4"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="url(#' + gid + ')"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + spine + '" height="' + h + '" rx="3" fill="#000" opacity=".22"/>' +
      '<rect x="' + (x + spine) + '" y="' + y + '" width="' + (w - spine) + '" height="' + h * 0.5 + '" fill="#fff" opacity=".08"/>' +
      '<text x="' + (x + spine + w * 0.1) + '" y="' + (y + h * 0.13) + '" fill="#fff" opacity=".85" font-family="Roboto, Arial, sans-serif" font-size="' + w * 0.065 + '" letter-spacing="2">' + esc(label.toUpperCase()) + "</text>" +
      textBlock(wrap(title, 11, 4), x + spine + w * 0.1, y + h * 0.62, w * 0.105, "#fff", "start");
  }

  function tablet(x, y, w, gid, title) {
    var h = w * 1.33;
    return '<rect x="' + (x + 4) + '" y="' + (y + 6) + '" width="' + w + '" height="' + h + '" rx="' + w * 0.07 + '" fill="#000" opacity=".08"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + w * 0.07 + '" fill="#1d1d21"/>' +
      '<rect x="' + (x + w * 0.06) + '" y="' + (y + w * 0.06) + '" width="' + w * 0.88 + '" height="' + (h - w * 0.12) + '" rx="' + w * 0.03 + '" fill="#fff"/>' +
      '<rect x="' + (x + w * 0.14) + '" y="' + (y + w * 0.14) + '" width="' + w * 0.72 + '" height="' + h * 0.42 + '" rx="3" fill="url(#' + gid + ')"/>' +
      textBlock(wrap(title, 12, 2), x + w / 2, y + w * 0.14 + h * 0.24, w * 0.085, "#fff") +
      [0, 1, 2, 3].map(function (i) { return '<rect x="' + (x + w * 0.14) + '" y="' + (y + h * (0.62 + i * 0.075)) + '" width="' + w * (0.72 - (i % 2) * 0.2) + '" height="' + w * 0.035 + '" rx="2" fill="#e6e6ea"/>'; }).join("");
  }

  function mockup(p) {
    var c = Array.isArray(p.color) && p.color.length === 2 && HEX.test(p.color[0]) && HEX.test(p.color[1]) ? p.color : ["#e50069", "#ff7eb3"];
    var id = "mk-" + String(p.id).replace(/[^a-z0-9-]/g, "");
    var short = p.title.split(":")[0];
    var label = L.TYPE_LABEL[p.type] ? L.TYPE_LABEL[p.type].replace(/s$/, "") : "";
    var defs = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient>' +
      '<linearGradient id="' + id + '-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c[1] + '"/><stop offset="1" stop-color="' + c[0] + '"/></linearGradient></defs>';
    var ground = '<ellipse cx="300" cy="338" rx="250" ry="12" fill="#000" opacity=".06"/>';
    var art;
    if (p.type === "course") {
      art = sheet(40, 70, 150, 200, -9, c[0]) + sheet(420, 92, 130, 175, 7, c[1]) + laptop(150, 92, 300, id, short) + phone(440, 168, 70, id + "-s");
    } else if (p.type === "book") {
      art = sheet(70, 80, 140, 190, -8, c[0]) + tablet(360, 96, 160, id + "-s", short) + book(200, 66, 170, id, short, label);
    } else if (p.type === "bundle") {
      art = sheet(30, 96, 130, 175, -10, c[0]) + laptop(110, 82, 270, id, short) + book(360, 104, 120, id + "-s", short, label) + phone(488, 186, 58, id);
    } else { // guide, template: printable pages and a phone
      art = sheet(150, 74, 170, 230, -12, c[0]) + sheet(205, 62, 170, 230, -2, c[1]) + sheet(260, 72, 170, 230, 9, c[0]) +
        '<g transform="rotate(-2 290 190)">' + '<rect x="205" y="62" width="170" height="230" rx="4" fill="#fff" stroke="#ececf0"/>' +
        '<rect x="205" y="62" width="170" height="78" rx="4" fill="url(#' + id + ')"/>' + textBlock(wrap(short, 14, 2), 290, 96, 16, "#fff") +
        [0, 1, 2, 3, 4].map(function (i) { return '<rect x="222" y="' + (158 + i * 22) + '" width="' + (136 - (i % 2) * 30) + '" height="8" rx="4" fill="#e6e6ea"/>'; }).join("") + "</g>" +
        phone(452, 150, 70, id + "-s");
    }
    return '<svg class="mockup" viewBox="25 40 550 357" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(p.title) + '" focusable="false">' +
      defs + ground + art + "</svg>";
  }

  function priceHtml(p) {
    var off = L.discountPercent(p);
    return '<span class="price"><strong>' + money(p.price, p.currency) + "</strong>" +
      (off ? " <s>" + money(p.compareAt, p.currency) + "</s> <em>Save " + off + "%</em>" : "") + "</span>";
  }

  function stars(value) {
    var pct = Math.max(0, Math.min(100, (value / 5) * 100));
    return '<span class="stars" role="img" aria-label="' + esc(value) + ' out of 5 stars" style="--pct:' + pct + '%">★★★★★</span>';
  }

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }

  function card(p) {
    var href = urls.product(p.id);
    return '<article class="card">' +
      '<a class="thumb" href="' + href + '" aria-label="' + esc(p.title) + '">' + (p.badge ? '<span class="badge">' + esc(p.badge) + "</span>" : "") + media(p) + "</a>" +
      '<h2><a href="' + href + '">' + esc(p.title) + "</a></h2>" +
      priceHtml(p) +
      '<button class="btn" type="button" data-add="' + esc(p.id) + '">Add to cart</button></article>';
  }

  function reviewItem(r, withProduct, products) {
    var p = withProduct ? L.getProduct(products || [], r.productId) : null;
    return '<li class="review"><div class="review-head"><strong>' + esc(r.name) + "</strong>" +
      (r.verified ? '<span class="verified">Verified buyer</span>' : "") + "</div>" +
      '<div class="review-meta">' + stars(r.rating) + (p ? ' <a href="' + urls.product(p.id) + '">' + esc(p.title) + "</a>" : "") +
      '<time datetime="' + esc(r.date) + '">' + esc(fmtDate(r.date)) + "</time></div>" +
      "<p>" + esc(r.text) + "</p></li>";
  }

  function summaryHtml(sum) {
    var rows = [5, 4, 3, 2, 1].map(function (s) {
      return "<li><span>" + s + '★</span><div class="meter" role="img" aria-label="' + sum.dist[s] + "% gave " + s +
        ' stars"><i style="width:' + sum.dist[s] + '%"></i></div><span>' + sum.dist[s] + "%</span></li>";
    }).join("");
    return '<div class="summary"><div class="score"><strong>' + sum.average.toFixed(1) + "</strong>" + stars(sum.average) +
      '<span class="muted">Based on ' + sum.count.toLocaleString("en-US") + " review" + (sum.count === 1 ? "" : "s") +
      '</span></div><ul class="dist">' + rows + "</ul></div>";
  }

  /* The full product view. `reviews` are this product's reviews (newest first). */
  function productView(p, reviews, related) {
    var qty = p.allowQuantity
      ? '<label class="qty-field"><span class="sr">Quantity</span><input id="qty" type="number" min="1" max="' + L.MAX_QTY + '" value="1"></label>'
      : "";
    var info = Object.keys(p.info || {}).map(function (k) {
      return '<tr><th scope="row">' + esc(k) + "</th><td>" + esc(p.info[k]) + "</td></tr>";
    }).join("");
    return '<div class="container product">' +
        '<div class="product-media">' + media(p) + "</div>" +
        '<div class="product-info"><h1>' + esc(p.title) + '</h1><p class="price-lg">' + priceHtml(p) + "</p><p>" + esc(p.summary) + "</p>" +
          '<div class="buy">' + qty + '<button class="btn" type="button" id="add-main">Add to cart</button></div>' +
          '<p class="cats">Category: ' + L.categoriesOf(p).map(function (c) {
            return '<a href="' + urls.category(c) + '">' + esc(c) + "</a>";
          }).join(", ") + "</p></div></div>" +
      '<div class="container tabs-wrap">' +
        '<div class="tabs" role="tablist" aria-label="Product details">' +
          '<button role="tab" id="t-desc" aria-controls="p-desc" aria-selected="true">Description</button>' +
          '<button role="tab" id="t-info" aria-controls="p-info" aria-selected="false" tabindex="-1">Additional information</button>' +
          '<button role="tab" id="t-rev" aria-controls="p-rev" aria-selected="false" tabindex="-1">Reviews (' + reviews.length + ")</button></div>" +
        '<div role="tabpanel" id="p-desc" aria-labelledby="t-desc"><h2>What\'s Included:</h2>' +
          p.description.map(function (d) { return "<p>" + esc(d) + "</p>"; }).join("") +
          '<ul class="ticks">' + p.included.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul></div>" +
        '<div role="tabpanel" id="p-info" aria-labelledby="t-info" hidden><table class="info">' + info + "</table></div>" +
        '<div role="tabpanel" id="p-rev" aria-labelledby="t-rev" hidden>' +
          (reviews.length ? summaryHtml(L.reviewSummary(reviews)) + '<ul class="reviews">' +
            reviews.map(function (r) { return reviewItem(r, false); }).join("") + "</ul>" : "<p>There are no reviews yet.</p>") +
        "</div></div>" +
      (related.length ? '<div class="container related"><h2>You may also like</h2><div class="grid">' + related.map(card).join("") + "</div></div>" : "");
  }

  /* schema.org Product for search engines (spec §6). Safe to embed in <script>. */
  function productJsonLd(p, reviews, pageUrl) {
    var ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.title,
      description: p.summary,
      url: pageUrl,
      sku: p.id,
      category: L.TYPE_LABEL[p.type] || p.type,
      offers: {
        "@type": "Offer",
        price: (p.priceMinor / 100).toFixed(2),
        priceCurrency: p.currency,
        availability: "https://schema.org/InStock",
        url: pageUrl,
      },
    };
    if (p.image && L.safeUrl(p.image.src)) ld.image = p.image.src;
    if (reviews.length) {
      var s = L.reviewSummary(reviews);
      ld.aggregateRating = { "@type": "AggregateRating", ratingValue: s.average, reviewCount: s.count };
    }
    return JSON.stringify(ld).replace(/</g, "\\u003c");
  }

  return {
    urls: urls, money: money, media: media, mockup: mockup, priceHtml: priceHtml, stars: stars, fmtDate: fmtDate, card: card,
    reviewItem: reviewItem, summaryHtml: summaryHtml, productView: productView, productJsonLd: productJsonLd,
  };
});
