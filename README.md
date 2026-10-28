# Carmen Business Web

A fast, dependency-free static storefront for selling **courses, books and bundles**: home, catalogue (courses / books / shop), product detail, about and contact pages, newsletter signup, dark mode, mobile menu, SEO metadata and accessibility basics. Structure and tone follow the author-coach brand model (hero, featured offers, bundle, story, testimonials, email capture).

## Edit the content (no code needed)

Everything is in **`assets/js/site-config.js`**: brand name, email, social links, hero copy, nav, about text, testimonials and the `products` list.

Add a product by copying an entry in `products` and giving it a unique `id`, `type` (`course` | `book` | `bundle`), `price`, optional `compareAt` (shows the discount), `color` (cover gradient) and `features`.

### Taking payments
Set each product's `checkoutUrl` to a hosted checkout link: Stripe Payment Link, Paystack/Flutterwave link, Gumroad, Teachable/Thinkific, Amazon, etc. The "Buy now" button sends buyers there, so no card data touches this site. With `checkoutUrl: ""` the page shows "Coming soon: get notified". Only `http(s)` or relative URLs are accepted.

### Forms
Set `brand.formEndpoint` to a Formspree/Basin/ConvertKit-style endpoint that accepts JSON POST. If empty, forms open the visitor's email app addressed to `brand.email`.

## Run, test, deploy
```bash
npm start            # http://localhost:8080
npm test             # unit + content/link validation (Node only)
npm run test:e2e     # headless browser smoke test (needs playwright)
```
Deploy the folder as-is to Netlify, Vercel, Cloudflare Pages, GitHub Pages or any static host. Replace `assets/favicon.svg`, and optionally add real cover images by extending `cover()` in `assets/js/main.js`.

## Layout
```
index.html courses.html books.html shop.html product.html about.html contact.html 404.html
assets/css/styles.css      design tokens + styles (edit :root colours/fonts)
assets/js/site-config.js   all content
assets/js/lib.js           pure helpers (escaping, price, URL safety), unit-tested
assets/js/main.js          renders header/footer/sections
tests/                     site.test.js (unit), e2e.js (browser)
```

## Notes
- Content is rendered client-side from the config; search engines that run JS (Google) index it, and product pages emit `Product` JSON-LD. If server-rendered HTML becomes important, add a small build step that pre-renders from the same config.
- All placeholder text, prices and testimonials must be replaced with the client's real content before launch.
