# Abide & Thrive â€” coaching website

Booking, Square payments, testimonials, and an admin area to edit everything. Needs Node 22.5+ (uses built-in SQLite).

## Run it

```
npm install
copy .env.example .env     # then edit .env
npm start
```

Open http://localhost:3000. On first run the console prints your admin login (`/admin`).
Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` before the first run to choose your own, or change them later in Admin > Account.

## Install from GitHub (recommended for TrueNAS or any Docker host)
Every push to `main` triggers `.github/workflows/docker.yml`, which builds the image and publishes it to `ghcr.io/reckertiii/abideandthrive:latest`.
1. Push the code (see below) and wait for the **Actions** tab to show a green check.
2. If the repo is private, create a GitHub token (Settings â†’ Developer settings â†’ Personal access tokens â†’ classic) with only `read:packages`, and add `ghcr.io` / your username / the token under TrueNAS **Apps â†’ Settings â†’ Manage Container Images**. Public repos: make the package public under the repo's **Packages** settings instead.
3. In TrueNAS **Apps â†’ Discover Apps â†’ Custom App â†’ Install via YAML**:
```yaml
services:
  abide:
    image: ghcr.io/reckertiii/abideandthrive:latest
    restart: unless-stopped
    ports:
      - "8090:3000"
    environment:
      SITE_URL: "http://192.168.1.50:8090"   # your TrueNAS IP and port
      ADMIN_EMAIL: "you@example.com"
      ADMIN_PASSWORD: "pick-a-long-password"
      SQUARE_ENV: sandbox
    volumes:
      - /mnt/tank/apps/abide/data:/data
```
4. To update: push changes, wait for the green check, then restart (or "Update") the app so it pulls the new image.

First push:
```
git remote add origin https://github.com/reckertiii/abideandthrive.git
git push -u origin main
```

## Testing on TrueNAS SCALE without GitHub (before going online)
Needs TrueNAS SCALE 24.10 or newer (Docker-based Apps). Older "Kubernetes" apps and TrueNAS CORE differ.
1. **Datasets:** create `apps/abide` with two folders, `app` and `data` (e.g. `/mnt/tank/apps/abide/app`, `/mnt/tank/apps/abide/data`).
2. **Copy the project** into the `app` folder (SMB share or `scp`): `server.js`, `package.json`, `package-lock.json`, `public/`. Don't copy `node_modules`, `data`, or `.env`.
3. **Apps â†’ Discover Apps â†’ Custom App â†’ â‹® Install via YAML**, name it `abide`, paste (adjust paths, port, IP, password):
```yaml
services:
  abide:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "npm ci --omit=dev && node server.js"
    restart: unless-stopped
    ports:
      - "8090:3000"
    environment:
      PORT: "3000"
      DATA_DIR: /data
      SITE_URL: "http://192.168.1.50:8090"   # your TrueNAS IP and the port above
      ADMIN_EMAIL: "you@example.com"
      ADMIN_PASSWORD: "pick-a-long-password"
      SQUARE_ENV: sandbox                      # add SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID to test payments
    volumes:
      - /mnt/tank/apps/abide/app:/app
      - /mnt/tank/apps/abide/data:/data
```
4. Open `http://<truenas-ip>:8090` (admin at `/admin`). First start takes a minute while it installs packages; check the app's logs. Email links print in the logs unless you set `RESEND_API_KEY`.
5. **Alternative:** with Docker on another machine, `docker compose up -d --build` uses the included `Dockerfile` and `docker-compose.yml`.

Notes for testing: use Square **sandbox** keys only, since the Square webhook can't reach a private address (the site still confirms payment when the client returns from checkout). Everything is plain HTTP on your LAN, which is fine for testing but not for real clients. When ready to go live, copy `data/site.db` to your real host to keep your content and bookings, or start clean.

## What the admin can edit (`/admin`)
- **Bookings** â€“ view, cancel/restore, mark paid
- **Site content** â€“ headline, about, how-it-works steps, FAQ, contact info, disclaimer, booking rules (time zone, notice, buffer, days off)
- **Services** â€“ add/edit/hide/delete services, length, and price ($0 = free)
- **Availability** â€“ weekly hours
- **Testimonials** â€“ approve client submissions, edit, unpublish, or record your own
- **Account** â€“ change login email/password

## Client accounts & email
- Anyone can book as a guest. After booking they're offered a free account: we email a link (verifies they own the email), they choose a password, and `/account` shows their bookings, lets them cancel (up to your minimum-notice window) and edit their details. "Forgot password" works the same way.
- Emails sent: booking confirmation to the client, new-booking alert and cancellation alerts to you (the contact email in Site content), account/reset links.
- Set `RESEND_API_KEY` and `MAIL_FROM` (a sender on a domain you've verified with resend.com). Without them, emails are printed to the server console instead of sent â€” fine for testing, but account links won't reach clients.
- Online cancellation does **not** refund payments automatically. The alert email to you says when a paid booking was canceled so you can refund it in Square.
- `DATA_DIR` env var changes where the database lives (point it at your host's persistent disk).

## Square payments
1. In the Square Developer Dashboard (developer.squareup.com/apps) create an application. Use the **Sandbox** access token and sandbox location ID to test.
2. Put them in `.env` as `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` (`SQUARE_ENV=sandbox`). For real money use the Production token/location and `SQUARE_ENV=production`.
3. Set `SITE_URL` to your public address. Add a webhook subscription for `payment.updated` pointing to `SITE_URL/api/square/webhook`, and put its signature key in `SQUARE_WEBHOOK_SIGNATURE_KEY`. (The site also checks payment when the client returns from checkout, so the webhook is a safety net.)

Without Square keys, paid sessions are booked as "pay at session". Unpaid checkouts release their time slot after 30 minutes.

## Before going live
- Replace the placeholder text (name, bio, FAQ, cancellation policy) in Admin > Site content, and review the disclaimer wording with your own professional/legal advice.
- Deploy behind HTTPS (e.g. Render, Railway, Fly.io, a VPS). Keep the `data/` folder on persistent storage and back it up â€” it holds all bookings and content.
- No confirmation emails are sent yet; clients see an on-screen confirmation and you see bookings in admin. Adding email (e.g. via Resend or SMTP) is the natural next step.
- Don't collect session notes or health details beyond what's needed; if you handle clients' health information, check your local privacy rules (e.g. HIPAA applies only if you're a covered provider).
