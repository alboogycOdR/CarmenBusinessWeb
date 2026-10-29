/*
 * Editable SITE CONTENT: brand, navigation, copy, reviews, free resources,
 * popup and discount codes shown in the browser.
 *
 * PRODUCTS ARE NOT HERE. Since PR 2 the catalogue lives in the database
 * (Supabase `products`, edited in the admin from PR 9) and is generated into
 * /assets/js/catalog.js by `npm run build` (scripts/build.mts). Prices shown in
 * the browser are display-only: checkout always re-prices from the database.
 *
 * Review `productId` values must match a published product slug; the build
 * fails if one does not.
 */
window.SITE = {
  brand: {
    name: "Carmen",
    tagline: "Practical courses and books for people who want results.",
    email: "hello@example.com",
    supportEmail: "support@example.com",
    currency: "USD",
    // POST endpoint for the contact + newsletter forms (Formspree, Basin,
    // ConvertKit...). Blank = forms open the visitor's email app instead.
    formEndpoint: "",
    social: {
      instagram: "https://instagram.com/",
      youtube: "https://youtube.com/",
      facebook: "https://facebook.com/",
    },
  },

  announcement: "Use code SAVE10 for 10% off your first order",

  nav: [
    { label: "Shop", href: "/" },
    { label: "Reviews", href: "/reviews.html" },
    { label: "Free Resources", href: "/free.html" },
    { label: "About", href: "/about.html" },
    { label: "Contact", href: "/contact.html" },
  ],

  shop: {
    title: "Courses",
    intro:
      "Thousands of students have taken our courses and read our books to learn practical, step-by-step strategies. Replace this with a short, confident description of who you help and the results they get.",
    perPage: 9,
  },

  /* Cart + checkout.
   * endpoint: the Payfast checkout function. Blank (e.g. a static preview
   * without functions) = the cart lets the customer email their order instead.
   * discounts: DISPLAY-ONLY previews of codes the cart can price in advance.
   * Real coupons live in the database and are validated at checkout. */
  checkout: {
    endpoint: "/api/checkout",
    discounts: { SAVE10: { percent: 10 } },
  },

  /* Newsletter popup that hands out a first-order discount. */
  popup: {
    enabled: true,
    delaySeconds: 8,
    title: "Get 10% off your first order",
    text: "Sign up to our newsletter and grab an instant discount, plus a free starter guide.",
    button: "Get my free guide",
    code: "SAVE10",
  },

  about: {
    headline: "Hi, I'm Carmen.",
    long: [
      "Replace this with Carmen's story: where she started, what she learned the hard way, and why she teaches what she teaches.",
      "Add credentials, years of experience, the number of students and readers served, and any press or speaking highlights.",
      "End with an invitation: what should a visitor do first? Read a book, start a course, or join the newsletter.",
    ],
    photo: "",
  },

  /* Free tutorials / lead magnets. url may be a YouTube link or a download. */
  free: {
    title: "Free Resources",
    intro: "Start learning today with no cost and no catch.",
    items: [
      { title: "Free Training: Getting Started", text: "A 30-minute video that walks through the basics.", url: "https://youtube.com/", cta: "Watch free" },
      { title: "The Starter Guide (PDF)", text: "Our 80-page guide to your first 30 days.", url: "", cta: "Get the guide", popup: true },
      { title: "Tutorial Library", text: "Short how-to videos on our YouTube channel.", url: "https://youtube.com/", cta: "Browse tutorials" },
    ],
  },

  /* Optional: override the computed rating summary with your real totals
   * (e.g. imported from a review platform): { count, average, dist:{5:97,4:2,3:1,2:0,1:0} } */
  reviewStats: null,

  reviews: [
      {
          "name": "Amara",
          "rating": 5,
          "date": "2026-10-27",
          "productId": "signature-course",
          "text": "Replace with a real customer review. Specific results and details work best.",
          "helpful": 0
      },
      {
          "name": "Joy",
          "rating": 5,
          "date": "2026-10-26",
          "productId": "starter-course",
          "text": "This course made a complicated topic feel achievable. Clear steps and great examples.",
          "helpful": 7
      },
      {
          "name": "Thandi",
          "rating": 5,
          "date": "2026-10-25",
          "productId": "book-one",
          "text": "I finally understood what to do first. The templates saved me hours.",
          "helpful": 3
      },
      {
          "name": "Bel",
          "rating": 4,
          "date": "2026-10-24",
          "productId": "masterclass",
          "text": "Honest, practical and easy to follow. Worth every cent.",
          "helpful": 10
      },
      {
          "name": "Naledi",
          "rating": 5,
          "date": "2026-10-23",
          "productId": "workbook",
          "text": "I read it in one sitting and immediately put three ideas into practice.",
          "helpful": 6
      },
      {
          "name": "Sam",
          "rating": 5,
          "date": "2026-10-22",
          "productId": "growth-course",
          "text": "The community and the worksheets made the difference for me.",
          "helpful": 2
      },
      {
          "name": "Rene",
          "rating": 5,
          "date": "2026-10-21",
          "productId": "book-two",
          "text": "Clear teaching with no fluff. I recommend it to every beginner.",
          "helpful": 9
      },
      {
          "name": "Lerato",
          "rating": 5,
          "date": "2026-10-20",
          "productId": "mindset-course",
          "text": "Great value. I keep coming back to the lessons as my business grows.",
          "helpful": 5
      },
      {
          "name": "Chipo",
          "rating": 4,
          "date": "2026-10-19",
          "productId": "signature-course",
          "text": "Replace with a real customer review. Specific results and details work best.",
          "helpful": 1
      },
      {
          "name": "Mia",
          "rating": 5,
          "date": "2026-10-18",
          "productId": "bundle",
          "text": "This course made a complicated topic feel achievable. Clear steps and great examples.",
          "helpful": 8
      },
      {
          "name": "Zanele",
          "rating": 5,
          "date": "2026-10-17",
          "productId": "planner",
          "text": "I finally understood what to do first. The templates saved me hours.",
          "helpful": 4
      },
      {
          "name": "Ines",
          "rating": 3,
          "date": "2026-10-16",
          "productId": "signature-course",
          "text": "Honest, practical and easy to follow. Worth every cent.",
          "helpful": 0
      }
  ],
};
