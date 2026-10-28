/*
 * ALL editable content lives here: brand, navigation, products, testimonials.
 * Replace the placeholder values below with the client's real content.
 * No build step: this file is loaded directly by every page.
 *
 * Product `checkoutUrl`: paste a hosted checkout link (Stripe Payment Link,
 * Paystack/Flutterwave link, Gumroad, Teachable, Amazon, etc.). The "Buy now"
 * button sends the visitor there. Leave "" to show a "Coming soon" state.
 */
window.SITE = {
  brand: {
    name: "Carmen",
    tagline: "Build a business and a life you love.",
    email: "hello@example.com",
    // Where the newsletter + contact forms POST. Use a Formspree/Basin/ConvertKit
    // style endpoint. Empty = forms fall back to opening the visitor's email app.
    formEndpoint: "",
    currency: "USD",
    social: {
      instagram: "https://instagram.com/",
      youtube: "https://youtube.com/",
      facebook: "https://facebook.com/",
    },
  },

  hero: {
    eyebrow: "Author · Coach · Educator",
    title: "Learn it. Live it. Grow it.",
    lead:
      "Practical courses and books to help you move from where you are to where you want to be, one clear step at a time.",
    primary: { label: "Explore courses", href: "courses.html" },
    secondary: { label: "Browse books", href: "books.html" },
    featuredId: "signature-course",
  },

  nav: [
    { label: "Courses", href: "courses.html" },
    { label: "Books", href: "books.html" },
    { label: "Shop all", href: "shop.html" },
    { label: "About", href: "about.html" },
    { label: "Contact", href: "contact.html" },
  ],

  about: {
    headline: "Hi, I'm Carmen.",
    short:
      "I help people turn knowledge into action through simple frameworks, honest stories and step-by-step teaching.",
    long: [
      "Replace this with Carmen's story: where she started, what she learned the hard way, and why she teaches what she teaches.",
      "Add credentials, years of experience, the number of students and readers served, and any press or speaking highlights.",
      "End with an invitation: what should a visitor do first? Read a book, start a course, or join the newsletter.",
    ],
    stats: [
      { value: "10k+", label: "Students taught" },
      { value: "5", label: "Books published" },
      { value: "12", label: "Years of experience" },
    ],
  },

  /* type: "course" | "book" | "bundle" ; badge is optional */
  products: [
    {
      id: "signature-course",
      type: "course",
      title: "The Signature Course",
      subtitle: "Your complete step-by-step programme",
      price: 197,
      compareAt: 297,
      badge: "Best seller",
      color: ["#2f4f46", "#6f9a86"],
      summary:
        "A self-paced video programme with workbooks, templates and a private community.",
      description: [
        "Replace with a compelling description of the transformation this course delivers and who it is for.",
        "Lifetime access, so students learn at their own pace and revisit lessons any time.",
      ],
      features: [
        "8 modules, 40+ video lessons",
        "Downloadable workbooks and templates",
        "Private student community",
        "Lifetime access and free updates",
        "30-day money-back guarantee",
      ],
      checkoutUrl: "",
    },
    {
      id: "starter-course",
      type: "course",
      title: "Starter Foundations",
      subtitle: "A short course to get your first win",
      price: 47,
      color: ["#b5654a", "#e2a58b"],
      summary: "Three focused lessons you can finish in a weekend.",
      description: [
        "Perfect for beginners who want a quick, low-risk way to start.",
      ],
      features: ["3 video lessons", "Quick-start checklist", "Lifetime access"],
      checkoutUrl: "",
    },
    {
      id: "masterclass",
      type: "course",
      title: "Live Masterclass Replay",
      subtitle: "Recorded workshop with Q&A",
      price: 79,
      color: ["#3b3f6b", "#8b90c9"],
      summary: "A 3-hour deep-dive workshop plus the full Q&A recording.",
      description: ["Replace with details of the masterclass content."],
      features: ["3 hours of video", "Slides and notes", "Q&A recording"],
      checkoutUrl: "",
    },
    {
      id: "book-one",
      type: "book",
      title: "The First Book",
      subtitle: "A practical guide",
      price: 24,
      badge: "New",
      color: ["#7a4b2a", "#d1a06b"],
      summary: "The book that started it all. Available as ebook and paperback.",
      description: [
        "Replace with the book blurb. Keep it to two or three short paragraphs and end with what the reader will gain.",
      ],
      features: ["Ebook (PDF/EPUB) instant download", "Bonus worksheets", "Print edition link available"],
      checkoutUrl: "",
    },
    {
      id: "book-two",
      type: "book",
      title: "The Second Book",
      subtitle: "Stories and lessons",
      price: 19,
      color: ["#23404f", "#6aa2b8"],
      summary: "Short, honest chapters you can read in one sitting.",
      description: ["Replace with the book blurb."],
      features: ["Ebook instant download", "Reading-group guide"],
      checkoutUrl: "",
    },
    {
      id: "workbook",
      type: "book",
      title: "The Companion Workbook",
      subtitle: "Printable exercises",
      price: 12,
      color: ["#5a3d5c", "#c295c4"],
      summary: "Printable worksheets that go with the course and books.",
      description: ["Replace with workbook details."],
      features: ["60+ page printable PDF", "Fillable fields"],
      checkoutUrl: "",
    },
    {
      id: "bundle",
      type: "bundle",
      title: "The Complete Bundle",
      subtitle: "Signature Course + both books + workbook",
      price: 229,
      compareAt: 334,
      badge: "Save 31%",
      color: ["#1f2d2a", "#c9a24a"],
      summary: "Everything in one package at the best price.",
      description: ["Replace with bundle details."],
      features: [
        "The Signature Course",
        "The First Book and The Second Book",
        "The Companion Workbook",
      ],
      checkoutUrl: "",
    },
  ],

  testimonials: [
    {
      quote: "Replace with a real student testimonial. Specific results work best.",
      name: "Student Name",
      role: "Course graduate",
    },
    {
      quote: "A second testimonial goes here. Keep each to one or two sentences.",
      name: "Reader Name",
      role: "Book reader",
    },
    {
      quote: "A third testimonial goes here.",
      name: "Client Name",
      role: "Coaching client",
    },
  ],

  newsletter: {
    title: "Get free weekly tips",
    text: "Join the list and receive a free starter guide plus practical ideas every week.",
  },
};
