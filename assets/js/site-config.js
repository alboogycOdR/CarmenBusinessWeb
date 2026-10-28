/*
 * ALL editable content lives here: brand, navigation, products, reviews, free
 * resources. Replace the placeholder values with the client's real content.
 * No build step: every page loads this file directly. The (optional) Netlify
 * checkout function also reads it, so prices can never be tampered with in the
 * browser.
 *
 * Product fields
 *   type         "course" | "book" | "bundle"   (also becomes a category)
 *   tags         extra categories shown in the sidebar filter
 *   image        optional path/URL to a product mockup (e.g. "assets/img/x.webp");
 *                blank = a generated cover using `color`
 *   checkoutUrl  optional hosted link (Stripe Payment Link, PayPal, Gumroad...)
 *                that enables a "Buy now" button and the no-server cart fallback
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
    { label: "Shop", href: "index.html" },
    { label: "Reviews", href: "reviews.html" },
    { label: "Free Resources", href: "free.html" },
    { label: "About", href: "about.html" },
    { label: "Contact", href: "contact.html" },
  ],

  shop: {
    title: "Courses",
    intro:
      "Thousands of students have taken our courses and read our books to learn practical, step-by-step strategies. Replace this with a short, confident description of who you help and the results they get.",
    perPage: 9,
  },

  /* Cart + checkout.
   * endpoint: URL of the checkout function (see README). Blank = no server:
   * the cart then shows a direct "Pay" link per item (needs checkoutUrl) or
   * lets the customer email their order. */
  checkout: {
    endpoint: "",
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

  products: [
      {
          "id": "signature-course",
          "type": "course",
          "title": "The Signature Course: Your Complete Programme",
          "price": 197,
          "compareAt": 297,
          "badge": "Best seller",
          "color": [
              "#e50069",
              "#ff7eb3"
          ],
          "tags": [
              "Marketing",
              "Beginner"
          ],
          "summary": "A self-paced video programme with workbooks, templates and a private community.",
          "description": [
              "Replace this with the transformation the course delivers and who it is for."
          ],
          "included": [
              "The complete step-by-step roadmap, from first idea to first customers.",
              "Plug-and-play templates and swipe files you can copy today.",
              "Real examples from our own tested campaigns.",
              "Private student community for feedback and accountability.",
              "Lifetime access and free updates."
          ],
          "info": {
              "Format": "Video lessons + PDF workbook",
              "Access": "Lifetime",
              "Level": "Beginner to intermediate",
              "Duration": "6 hours"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "starter-course",
          "type": "course",
          "title": "Starter Foundations: Your First Win",
          "price": 47,
          "badge": "New",
          "color": [
              "#4915e5",
              "#a58bff"
          ],
          "tags": [
              "Beginner"
          ],
          "summary": "Three focused lessons you can finish in a weekend.",
          "description": [
              "Perfect for beginners who want a quick, low-risk way to start."
          ],
          "included": [
              "3 short video lessons.",
              "Quick-start checklist.",
              "Lifetime access."
          ],
          "info": {
              "Format": "Video lessons",
              "Access": "Lifetime",
              "Level": "Beginner",
              "Duration": "1 hour"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "masterclass",
          "type": "course",
          "title": "Live Masterclass Replay with Q&A",
          "price": 79,
          "color": [
              "#142341",
              "#4a6fa5"
          ],
          "tags": [
              "Marketing"
          ],
          "summary": "A 3-hour deep-dive workshop plus the full Q&A recording.",
          "description": [
              "Replace with details of the masterclass content."
          ],
          "included": [
              "3 hours of recorded training.",
              "Slides and notes.",
              "Full Q&A recording."
          ],
          "info": {
              "Format": "Video replay",
              "Access": "Lifetime",
              "Level": "All levels",
              "Duration": "3 hours"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "mindset-course",
          "type": "course",
          "title": "Confident Action: A Mindset Course",
          "price": 67,
          "color": [
              "#b5654a",
              "#f0b49b"
          ],
          "tags": [
              "Mindset"
          ],
          "summary": "Practical exercises to build confidence and follow through.",
          "description": [
              "Replace with course details."
          ],
          "included": [
              "5 guided lessons.",
              "Daily action planner.",
              "Audio versions for on the go."
          ],
          "info": {
              "Format": "Video + audio",
              "Access": "Lifetime",
              "Level": "All levels",
              "Duration": "2 hours"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "growth-course",
          "type": "course",
          "title": "Scale It: Growing Beyond Your First Sales",
          "price": 300,
          "color": [
              "#0b6e4f",
              "#6fd6b1"
          ],
          "tags": [
              "Marketing",
              "Scale"
          ],
          "summary": "How we grow revenue per customer once the first sales are in.",
          "description": [
              "Replace with course details."
          ],
          "included": [
              "Pricing and offer structure.",
              "Upsell and repeat-purchase playbook.",
              "Automation checklists."
          ],
          "info": {
              "Format": "Video lessons",
              "Access": "Lifetime",
              "Level": "Intermediate",
              "Duration": "4 hours"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "book-one",
          "type": "book",
          "title": "The First Book: A Practical Guide",
          "price": 24,
          "badge": "New",
          "color": [
              "#7a4b2a",
              "#d1a06b"
          ],
          "tags": [
              "Beginner",
              "Mindset"
          ],
          "summary": "The book that started it all. Ebook with bonus worksheets.",
          "description": [
              "Replace with the book blurb: two or three short paragraphs ending with what the reader will gain."
          ],
          "included": [
              "Ebook (PDF and EPUB), instant download.",
              "Bonus worksheets.",
              "Link to the print edition."
          ],
          "info": {
              "Format": "PDF + EPUB",
              "Access": "Instant download",
              "Pages": "220"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "book-two",
          "type": "book",
          "title": "The Second Book: Stories and Lessons",
          "price": 19,
          "color": [
              "#23404f",
              "#6aa2b8"
          ],
          "tags": [
              "Mindset"
          ],
          "summary": "Short, honest chapters you can read in one sitting.",
          "description": [
              "Replace with the book blurb."
          ],
          "included": [
              "Ebook, instant download.",
              "Reading-group guide."
          ],
          "info": {
              "Format": "PDF + EPUB",
              "Access": "Instant download",
              "Pages": "180"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "workbook",
          "type": "book",
          "title": "The Companion Workbook",
          "price": 12,
          "color": [
              "#5a3d5c",
              "#c295c4"
          ],
          "tags": [
              "Worksheets"
          ],
          "summary": "Printable worksheets that go with the course and books.",
          "description": [
              "Replace with workbook details."
          ],
          "included": [
              "60+ page printable PDF.",
              "Fillable fields."
          ],
          "info": {
              "Format": "PDF",
              "Access": "Instant download",
              "Pages": "64"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "planner",
          "type": "book",
          "title": "90-Day Action Planner",
          "price": 15,
          "color": [
              "#c9a24a",
              "#f2dc9b"
          ],
          "tags": [
              "Worksheets"
          ],
          "summary": "A printable planner to turn goals into weekly actions.",
          "description": [
              "Replace with planner details."
          ],
          "included": [
              "Quarterly, monthly and weekly pages.",
              "Habit and revenue trackers."
          ],
          "info": {
              "Format": "PDF",
              "Access": "Instant download",
              "Pages": "48"
          },
          "image": "",
          "checkoutUrl": ""
      },
      {
          "id": "bundle",
          "type": "bundle",
          "title": "The Complete Bundle: Course + Books + Workbook",
          "price": 229,
          "compareAt": 334,
          "badge": "Save 31%",
          "color": [
              "#1f1f1f",
              "#e50069"
          ],
          "tags": [
              "Marketing"
          ],
          "summary": "Everything in one package at the best price.",
          "description": [
              "Replace with bundle details."
          ],
          "included": [
              "The Signature Course.",
              "The First Book and The Second Book.",
              "The Companion Workbook."
          ],
          "info": {
              "Format": "Video + PDF + EPUB",
              "Access": "Lifetime",
              "Level": "All levels"
          },
          "image": "",
          "checkoutUrl": ""
      }
  ],

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
