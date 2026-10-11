# Changelog — Abide & Thrive

All notable changes, bug fixes, and enhancements to the **Abide & Thrive** website are tracked in this file.

---

## [1.1.0] - 2026-10-11

### Backend & Scheduling Fixes (`server.js`, `data/site.db`, `README.md`)
- **Fixed Square Checkout Return Confirmation (`GET /api/bookings/confirm`)**:
  - Updated `/api/bookings/confirm` to accept either `id` (from Square's `/?paid=<id>#book` redirect) or `order_id`, look up the booking's `payment_ref`, verify payment status with Square, and return full booking metadata (`id`, `serviceName`, `date`, `time`, `durationMin`, `mode`, `status`, `paid`, `email`).
- **Fixed Timezone Date Rollover (`GET /api/site`, `GET /api/admin/me`, `GET /api/account/me`)**:
  - Exposed `today` calculated in the configured coach timezone (`nowIn(settings.timezone).date`) so client/admin views no longer use UTC (`new Date().toISOString().slice(0, 10)`), which previously rolled over to tomorrow at 7–8 PM US time.
- **Improved Scheduling Slot Logic (`slotsFor`)**:
  - Replaced hardcoded `diff === 0` / `diff === 1` checks with `hoursUntil(date, hhmm, settings.timezone) < settings.minNoticeHours` so any minimum-notice window (including 48+ hours) is accurately enforced.
  - Changed slot start-time stepping to `Math.min(30, service.duration_min + settings.bufferMin)` (30-minute intervals) while preserving full duration + buffer conflict checks, and deduplicated slots across adjacent availability windows.
- **Enhanced Admin Booking Management (`PUT /api/admin/bookings/:id`)**:
  - Added conflict detection when restoring a canceled booking so two sessions cannot be double-booked into the same slot.
  - Added automatic client cancellation notification email when an admin cancels a confirmed booking.
- **Added Coach Photo Support & Session Cleanup**:
  - Added `coachPhoto` setting to `DEFAULTS` and updated `Content-Security-Policy` (`img-src 'self' data: https:`) and JSON body limit (`350kb`) so coaches can upload a headshot or provide an image URL in Admin > Site content.
  - Added hourly cleanup for expired client sessions (`csessions`) and expired email verification tokens (`tokens` table).
  - Included signed-in client profile info (`client: { name, email, phone }`) in `GET /api/site` for automatic booking form pre-fill.
- **Database & Documentation Cleanup**:
  - Fixed double-punctuation typo (`in them.,` → `in them,`) in the stored John 15:5 (NLT) verse in `data/site.db` and `server.js`.
  - Fixed UTF-8 character encoding artifacts (`â€”`, `â†’`) and removed outdated email notice in `README.md`.

### Visual, Layout & SEO Improvements (`public/styles.css`, `public/index.html`, `public/admin.html`, `public/account.html`, `public/favicon.svg`)
- **Fixed Service Picker Radio Card Layout Bug (`public/styles.css`)**:
  - Added `width: auto; margin-top: 5px; flex-shrink: 0;` to `.pick input` so `<input type="radio">` inside **"1. Choose a service"** no longer inherits `width: 100%` and squishes service titles to the right.
- **Balanced Two-Column Hero Section (`public/index.html`, `public/styles.css`)**:
  - Added a `.hero-grid` layout on desktop with a frosted-glass coaching highlights card (`.hero-card`) alongside the main headline, verse, and CTAs.
- **Equal-Height Service Cards & "Start here" Badge (`public/styles.css`, `public/app.js`)**:
  - Styled `#serviceList > .card` as a flex column with `margin-top: auto` on `.btn` so all `"Book this"` buttons align horizontally at the bottom of the cards.
  - Added a `"Start here"` pill badge (`.svc-badge`) on free discovery calls.
- **Coach Photo / Initials Avatar (`public/index.html`, `public/styles.css`, `public/app.js`, `public/admin.js`)**:
  - Added `.coach-head` and `#coachAvatar` in the **"Meet your coach"** section, displaying the coach's uploaded photo or a sage-green initials monogram fallback.
  - Added an automatic client-side image resizer (`<canvas>` to 280px JPEG data URL) and URL input in **Admin > Site content > About you**.
- **Custom SVG Favicon & OpenGraph Tags (`public/favicon.svg`, `public/*.html`)**:
  - Created a sage-green olive branch SVG favicon (`public/favicon.svg`) and linked it across `index.html`, `admin.html`, and `account.html`.
  - Added OpenGraph (`og:title`, `og:description`, `og:type`) meta tags to `index.html`.
- **Admin Form Grid Fix (`public/admin.js`)**:
  - Moved the `"Show on website & allow booking"` checkbox out of the 2-column `.two` grid in the Services editor so it sits cleanly on its own row.

### Client Experience Enhancements (`public/app.js`, `public/account.js`)
- **"Add to Calendar" (`.ics` & Google Calendar)**:
  - Added **📅 Add to Calendar (.ics)** and **Google Calendar ↗** buttons to the booking confirmation notice on the home page (`public/app.js`) and to upcoming booking cards in the Client Portal (`public/account.js`).
- **Booking Horizon & Pre-fill**:
  - Enforced both `min` (`site.today`) and `max` (`site.today` + `horizonDays`) on `#dateInput`.
  - Automatically pre-filled `name`, `email`, and `phone` in Step 4 when a client is signed in.
