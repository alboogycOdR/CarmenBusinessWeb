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
    var c = p.color || ["#e50069", "#ff7eb3"];
    return '<div class="cover cover-' + esc(p.type) + '" style="--c1:' + esc(c[0]) + ";--c2:" + esc(c[1]) + '" role="img" aria-label="' + esc(p.title) + '">' +
      '<span class="cover-type">' + esc(L.TYPE_LABEL[p.type] || "") + "</span>" +
      '<span class="cover-title">' + esc(p.title.split(":")[0]) + "</span></div>";
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
    urls: urls, money: money, media: media, priceHtml: priceHtml, stars: stars, fmtDate: fmtDate, card: card,
    reviewItem: reviewItem, summaryHtml: summaryHtml, productView: productView, productJsonLd: productJsonLd,
  };
});
