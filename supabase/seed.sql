-- Local/CI seed data ONLY. Applied by `supabase start` / `supabase db reset`.
-- Never pushed to staging or production (no --include-seed).
-- Mirrors the placeholder storefront catalogue so PR 2 can switch the site to
-- the database without visible change, and covers every delivery shape:
--   file-only, external-instant, external-manual, mixed (file + external), bundle,
--   plus draft and archived products for authorization tests.
-- Currency is USD to match today's storefront; decision D2 may change it.
-- No auth users or staff are seeded: tests create their own, and real staff are
-- granted by an owner-run script (PR 8).

insert into public.categories (id, slug, name, sort) values
  ('c0000000-0000-4000-8000-000000000001', 'marketing',  'Marketing',  1),
  ('c0000000-0000-4000-8000-000000000002', 'beginner',   'Beginner',   2),
  ('c0000000-0000-4000-8000-000000000003', 'mindset',    'Mindset',    3),
  ('c0000000-0000-4000-8000-000000000004', 'scale',      'Scale',      4),
  ('c0000000-0000-4000-8000-000000000005', 'worksheets', 'Worksheets', 5);

insert into public.products
  (id, slug, type, status, title, summary, description, included, info, display, price_minor, compare_at_minor, currency, sort, published_at, archived_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'signature-course', 'course', 'published',
   'The Signature Course: Your Complete Programme',
   'A self-paced video programme with workbooks, templates and a private community.',
   array['Replace this with the transformation the course delivers and who it is for.'],
   array['The complete step-by-step roadmap, from first idea to first customers.', 'Plug-and-play templates and swipe files you can copy today.', 'Real examples from our own tested campaigns.', 'Private student community for feedback and accountability.', 'Lifetime access and free updates.'],
   '{"Format": "Video lessons + PDF workbook", "Access": "Lifetime", "Level": "Beginner to intermediate", "Duration": "6 hours"}',
   '{"badge": "Best seller", "color": ["#e50069", "#ff7eb3"]}', 19700, 29700, 'USD', 1, now(), null),
  ('a0000000-0000-4000-8000-000000000002', 'starter-course', 'course', 'published',
   'Starter Foundations: Your First Win', 'Three focused lessons you can finish in a weekend.',
   array['Perfect for beginners who want a quick, low-risk way to start.'],
   array['3 short video lessons.', 'Quick-start checklist.', 'Lifetime access.'],
   '{"Format": "Video lessons", "Access": "Lifetime", "Level": "Beginner", "Duration": "1 hour"}',
   '{"badge": "New", "color": ["#4915e5", "#a58bff"]}', 4700, null, 'USD', 2, now(), null),
  ('a0000000-0000-4000-8000-000000000003', 'masterclass', 'course', 'published',
   'Live Masterclass Replay with Q&A', 'A 3-hour deep-dive workshop plus the full Q&A recording.',
   array['Replace with details of the masterclass content.'],
   array['3 hours of recorded training.', 'Slides and notes.', 'Full Q&A recording.'],
   '{"Format": "Video replay", "Access": "Lifetime", "Level": "All levels", "Duration": "3 hours"}',
   '{"color": ["#142341", "#4a6fa5"]}', 7900, null, 'USD', 3, now(), null),
  ('a0000000-0000-4000-8000-000000000004', 'mindset-course', 'course', 'published',
   'Confident Action: A Mindset Course', 'Practical exercises to build confidence and follow through.',
   array['Replace with course details.'],
   array['5 guided lessons.', 'Daily action planner.', 'Audio versions for on the go.'],
   '{"Format": "Video + audio", "Access": "Lifetime", "Level": "All levels", "Duration": "2 hours"}',
   '{"color": ["#b5654a", "#f0b49b"]}', 6700, null, 'USD', 4, now(), null),
  ('a0000000-0000-4000-8000-000000000005', 'growth-course', 'course', 'published',
   'Scale It: Growing Beyond Your First Sales', 'How we grow revenue per customer once the first sales are in.',
   array['Replace with course details.'],
   array['Pricing and offer structure.', 'Upsell and repeat-purchase playbook.', 'Automation checklists.'],
   '{"Format": "Video lessons", "Access": "Lifetime", "Level": "Intermediate", "Duration": "4 hours"}',
   '{"color": ["#0b6e4f", "#6fd6b1"]}', 30000, null, 'USD', 5, now(), null),
  ('a0000000-0000-4000-8000-000000000006', 'book-one', 'book', 'published',
   'The First Book: A Practical Guide', 'The book that started it all. Ebook with bonus worksheets.',
   array['Replace with the book blurb: two or three short paragraphs ending with what the reader will gain.'],
   array['Ebook (PDF and EPUB), instant download.', 'Bonus worksheets.', 'Link to the print edition.'],
   '{"Format": "PDF + EPUB", "Access": "Instant download", "Pages": "220"}',
   '{"badge": "New", "color": ["#7a4b2a", "#d1a06b"]}', 2400, null, 'USD', 6, now(), null),
  ('a0000000-0000-4000-8000-000000000007', 'book-two', 'book', 'published',
   'The Second Book: Stories and Lessons', 'Short, honest chapters you can read in one sitting.',
   array['Replace with the book blurb.'],
   array['Ebook, instant download.', 'Reading-group guide.'],
   '{"Format": "PDF + EPUB", "Access": "Instant download", "Pages": "180"}',
   '{"color": ["#23404f", "#6aa2b8"]}', 1900, null, 'USD', 7, now(), null),
  ('a0000000-0000-4000-8000-000000000008', 'workbook', 'template', 'published',
   'The Companion Workbook', 'Printable worksheets that go with the course and books.',
   array['Replace with workbook details.'],
   array['60+ page printable PDF.', 'Fillable fields.'],
   '{"Format": "PDF", "Access": "Instant download", "Pages": "64"}',
   '{"color": ["#5a3d5c", "#c295c4"]}', 1200, null, 'USD', 8, now(), null),
  ('a0000000-0000-4000-8000-000000000009', 'planner', 'guide', 'published',
   '90-Day Action Planner', 'A printable planner to turn goals into weekly actions.',
   array['Replace with planner details.'],
   array['Quarterly, monthly and weekly pages.', 'Habit and revenue trackers.'],
   '{"Format": "PDF", "Access": "Instant download", "Pages": "48"}',
   '{"color": ["#c9a24a", "#f2dc9b"]}', 1500, null, 'USD', 9, now(), null),
  ('a0000000-0000-4000-8000-000000000010', 'bundle', 'bundle', 'published',
   'The Complete Bundle: Course + Books + Workbook', 'Everything in one package at the best price.',
   array['Replace with bundle details.'],
   array['The Signature Course.', 'The First Book and The Second Book.', 'The Companion Workbook.'],
   '{"Format": "Video + PDF + EPUB", "Access": "Lifetime", "Level": "All levels"}',
   '{"badge": "Save 31%", "color": ["#1f1f1f", "#e50069"]}', 22900, 33400, 'USD', 10, now(), null),
  -- Not visible to the public: used by authorization tests.
  ('a0000000-0000-4000-8000-000000000011', 'upcoming-course', 'course', 'draft',
   'Upcoming Course (draft)', 'Not yet published.', '{}', '{}', '{}', '{}', 9900, null, 'USD', 11, null, null),
  ('a0000000-0000-4000-8000-000000000012', 'old-guide', 'guide', 'archived',
   'Old Guide (archived)', 'No longer sold.', '{}', '{}', '{}', '{}', 900, null, 'USD', 12, now() - interval '1 year', now());

insert into public.product_categories (product_id, category_id) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001');

insert into public.bundle_items (bundle_id, product_id) values
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000006'),
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000007'),
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000008');

-- example.com / example.org are reserved for documentation (RFC 2606): safe placeholders.
insert into public.product_assets (id, product_id, kind, label, storage_path, external_url, instructions, access_mode, manual_eta_text, sort) values
  -- mixed: external course + downloadable workbook
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'external', 'Course access',
   null, 'https://courses.example.com/signature', 'Sign in with the email you used at checkout.', 'instant', null, 1),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'file', 'Signature workbook (PDF)',
   'signature-course/workbook.pdf', null, null, 'instant', null, 2),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'external', 'Course access',
   null, 'https://courses.example.com/starter', 'Use the enrolment link within 30 days.', 'instant', null, 1),
  -- external with manual enrolment (truthful timing, spec §4.2)
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 'external', 'Masterclass replay access',
   null, 'https://courses.example.com/masterclass', 'We add you to the replay group by hand.', 'manual', 'within 1 business day', 1),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004', 'external', 'Course access',
   null, 'https://courses.example.com/mindset', null, 'instant', null, 1),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000005', 'external', 'Course access',
   null, 'https://courses.example.org/scale', 'Access is granted manually after purchase.', 'manual', 'within 2 business days', 1),
  -- file-only (two formats)
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000006', 'file', 'The First Book (PDF)',
   'book-one/the-first-book.pdf', null, null, 'instant', null, 1),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000006', 'file', 'The First Book (EPUB)',
   'book-one/the-first-book.epub', null, null, 'instant', null, 2),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000007', 'file', 'The Second Book (PDF)',
   'book-two/the-second-book.pdf', null, null, 'instant', null, 1),
  ('b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000008', 'file', 'Companion Workbook (PDF)',
   'workbook/companion-workbook.pdf', null, null, 'instant', null, 1),
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000009', 'file', '90-Day Planner (PDF)',
   'planner/90-day-planner.pdf', null, null, 'instant', null, 1),
  ('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000012', 'file', 'Old Guide (PDF)',
   'old-guide/old-guide.pdf', null, null, 'instant', null, 1);

insert into public.coupons (id, code, percent_off, amount_off_minor, currency, starts_at, ends_at, max_redemptions, per_email_limit, active) values
  ('d0000000-0000-4000-8000-000000000001', 'SAVE10', 10, null, null, null, null, null, 1, true),
  ('d0000000-0000-4000-8000-000000000002', 'EXPIRED5', 5, null, null, now() - interval '60 days', now() - interval '30 days', null, null, true),
  ('d0000000-0000-4000-8000-000000000003', 'FIXED20', null, 2000, 'USD', null, null, 100, null, true);
