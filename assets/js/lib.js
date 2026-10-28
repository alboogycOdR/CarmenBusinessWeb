/* Pure helpers (no DOM) so they can be unit-tested in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SiteLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ESC[c];
    });
  }

  function formatPrice(amount, currency) {
    var n = Number(amount);
    if (!isFinite(n)) return "";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n);
    } catch (e) {
      return "$" + n.toFixed(n % 1 === 0 ? 0 : 2);
    }
  }

  function getProduct(products, id) {
    for (var i = 0; i < products.length; i++) if (products[i].id === id) return products[i];
    return null;
  }

  function filterProducts(products, type) {
    if (!type || type === "all") return products.slice();
    return products.filter(function (p) {
      return p.type === type;
    });
  }

  function discountPercent(p) {
    if (!p.compareAt || p.compareAt <= p.price) return 0;
    return Math.round((1 - p.price / p.compareAt) * 100);
  }

  /* Only allow http(s) or relative checkout links; blocks javascript: URLs. */
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
    return (
      "mailto:" + encodeURIComponent(to).replace(/%40/g, "@") +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body)
    );
  }

  return {
    esc: esc,
    formatPrice: formatPrice,
    getProduct: getProduct,
    filterProducts: filterProducts,
    discountPercent: discountPercent,
    safeUrl: safeUrl,
    isEmail: isEmail,
    mailtoHref: mailtoHref,
  };
});
