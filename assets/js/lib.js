/* Pure helpers (no DOM, no storage) so they can be unit-tested in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SiteLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var TYPE_LABEL = { course: "Courses", book: "Books", guide: "Guides", template: "Templates", bundle: "Bundles" };
  var MAX_QTY = 99;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ESC[c];
    });
  }

  /* D17: rands as "R1 997.00": no-break space between thousands (so a price
   * never wraps), point for decimals. Other currencies use Intl. */
  function formatZar(n) {
    var cents = Math.round(Math.abs(n) * 100);
    var whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return (n < 0 ? "-" : "") + "R" + whole + "." + String(cents % 100).padStart(2, "0");
  }

  function formatPrice(amount, currency) {
    var n = Number(amount);
    if (!isFinite(n)) return "";
    if (currency === "ZAR") return formatZar(n);
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
    } catch (e) {
      return "$" + n.toFixed(2);
    }
  }

  function toCents(amount) {
    return Math.round(Number(amount) * 100);
  }

  function getProduct(products, id) {
    for (var i = 0; i < products.length; i++) if (products[i].id === id) return products[i];
    return null;
  }

  /* Categories = the product's type label plus its free-form tags. */
  function categoriesOf(p) {
    var out = [];
    if (TYPE_LABEL[p.type]) out.push(TYPE_LABEL[p.type]);
    return out.concat(p.tags || []);
  }

  function allCategories(products) {
    var seen = {}, out = [];
    products.forEach(function (p) {
      categoriesOf(p).forEach(function (c) {
        if (!seen[c]) { seen[c] = 1; out.push(c); }
      });
    });
    return out;
  }

  /* q: text, min/max: price bounds (blank = unbounded), cats: any-of list. */
  function filterProducts(products, f) {
    f = f || {};
    var q = String(f.q || "").trim().toLowerCase();
    var min = f.min === "" || f.min == null ? -Infinity : Number(f.min);
    var max = f.max === "" || f.max == null ? Infinity : Number(f.max);
    var cats = f.cats || [];
    return products.filter(function (p) {
      if (q && (p.title + " " + (p.summary || "") + " " + (p.subtitle || "")).toLowerCase().indexOf(q) === -1) return false;
      if (p.price < min || p.price > max) return false;
      if (cats.length) {
        var mine = categoriesOf(p);
        if (!cats.some(function (c) { return mine.indexOf(c) !== -1; })) return false;
      }
      return true;
    });
  }

  function sortProducts(products, key) {
    var arr = products.slice();
    if (key === "price-asc") arr.sort(function (a, b) { return a.price - b.price; });
    else if (key === "price-desc") arr.sort(function (a, b) { return b.price - a.price; });
    else if (key === "title") arr.sort(function (a, b) { return a.title.localeCompare(b.title); });
    return arr;
  }

  function paginate(items, page, per) {
    per = Math.max(1, per | 0);
    var pages = Math.max(1, Math.ceil(items.length / per));
    var p = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
    return { items: items.slice((p - 1) * per, p * per), page: p, pages: pages, total: items.length };
  }

  function discountPercent(p) {
    if (!p.compareAt || p.compareAt <= p.price) return 0;
    return Math.round((1 - p.price / p.compareAt) * 100);
  }

  /* ---------- Cart (array of {id, qty}) ---------- */
  /* ADR-0008: a digital licence is bought once unless the product allows quantity. */
  function maxQtyFor(product) {
    return product && product.allowQuantity ? MAX_QTY : 1;
  }

  function parseCart(raw, products) {
    var data;
    try { data = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(data)) return [];
    var seen = {};
    return data.reduce(function (acc, it) {
      var product = products && it && typeof it.id === "string" ? getProduct(products, it.id) : null;
      var limit = products ? maxQtyFor(product) : MAX_QTY;
      var qty = Math.min(limit, parseInt(it && it.qty, 10) || 0);
      if (it && typeof it.id === "string" && qty > 0 && !seen[it.id] && (!products || product)) {
        seen[it.id] = 1;
        acc.push({ id: it.id, qty: qty });
      }
      return acc;
    }, []);
  }

  function cartAdd(cart, id, qty, limit) {
    limit = limit || MAX_QTY;
    qty = Math.max(1, parseInt(qty, 10) || 1);
    var found = false;
    var next = cart.map(function (it) {
      if (it.id !== id) return it;
      found = true;
      return { id: id, qty: Math.min(limit, it.qty + qty) };
    });
    if (!found) next.push({ id: id, qty: Math.min(limit, qty) });
    return next;
  }

  function cartSet(cart, id, qty, limit) {
    qty = Math.min(limit || MAX_QTY, parseInt(qty, 10) || 0);
    return cart
      .map(function (it) { return it.id === id ? { id: id, qty: qty } : it; })
      .filter(function (it) { return it.qty > 0; });
  }

  function cartCount(cart) {
    return cart.reduce(function (n, it) { return n + it.qty; }, 0);
  }

  function cartLines(cart, products) {
    return cart.reduce(function (acc, it) {
      var p = getProduct(products, it.id);
      if (p) acc.push({ product: p, qty: it.qty, cents: toCents(p.price) * it.qty });
      return acc;
    }, []);
  }

  /* discounts: { CODE: { percent: 10 } }. Returns amounts in cents. */
  function cartTotals(lines, code, discounts) {
    var subtotal = lines.reduce(function (n, l) { return n + l.cents; }, 0);
    var key = String(code || "").trim().toUpperCase();
    var rule = key && discounts && Object.prototype.hasOwnProperty.call(discounts, key) ? discounts[key] : null;
    var off = rule ? Math.round((subtotal * rule.percent) / 100) : 0;
    return { subtotal: subtotal, discount: off, total: subtotal - off, code: rule ? key : "", percent: rule ? rule.percent : 0 };
  }

  /* ---------- Reviews ---------- */
  function reviewSummary(reviews, override) {
    if (override) return override;
    var count = reviews.length;
    var dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    var sum = 0;
    reviews.forEach(function (r) { dist[r.rating]++; sum += r.rating; });
    var pct = {};
    for (var s = 5; s >= 1; s--) pct[s] = count ? Math.round((dist[s] / count) * 100) : 0;
    return { count: count, average: count ? Math.round((sum / count) * 10) / 10 : 0, dist: pct };
  }

  function filterReviews(reviews, f) {
    f = f || {};
    var q = String(f.q || "").trim().toLowerCase();
    return reviews.filter(function (r) {
      if (f.productId && r.productId !== f.productId) return false;
      if (q && (r.text + " " + r.name + " " + (r.title || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function sortReviews(reviews, key) {
    var arr = reviews.slice();
    var byDate = function (a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; };
    if (key === "high") arr.sort(function (a, b) { return b.rating - a.rating || byDate(a, b); });
    else if (key === "low") arr.sort(function (a, b) { return a.rating - b.rating || byDate(a, b); });
    else if (key === "helpful") arr.sort(function (a, b) { return (b.helpful || 0) - (a.helpful || 0) || byDate(a, b); });
    else arr.sort(byDate);
    return arr;
  }

  /* ---------- Safety / forms ---------- */
  /* Only allow http(s) or plain relative links; blocks javascript:/data: URLs. */
  function safeUrl(url) {
    if (!url) return "";
    var u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w./?#=&%-]+$/.test(u) && !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    return "";
  }

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
  }

  function mailtoHref(to, subject, body) {
    return "mailto:" + encodeURIComponent(to).replace(/%40/g, "@") +
      "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  return {
    MAX_QTY: MAX_QTY, TYPE_LABEL: TYPE_LABEL,
    esc: esc, formatPrice: formatPrice, toCents: toCents, getProduct: getProduct,
    categoriesOf: categoriesOf, allCategories: allCategories,
    filterProducts: filterProducts, sortProducts: sortProducts, paginate: paginate,
    discountPercent: discountPercent,
    maxQtyFor: maxQtyFor, parseCart: parseCart, cartAdd: cartAdd, cartSet: cartSet, cartCount: cartCount,
    cartLines: cartLines, cartTotals: cartTotals,
    reviewSummary: reviewSummary, filterReviews: filterReviews, sortReviews: sortReviews,
    safeUrl: safeUrl, isEmail: isEmail, mailtoHref: mailtoHref,
  };
});
