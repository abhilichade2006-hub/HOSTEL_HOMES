# Hostel Homes — Full-stack working prototype

A full-stack Express app with password-hashed accounts, JWT login, server-enforced roles, property listings, admin approval, favourites and booking enquiries. Set `DATABASE_URL` to use Neon PostgreSQL for persistent online storage. Without it, local development uses `hostel-homes.sqlite`.

## Start on Windows

1. Install **Node.js 22.16 or newer** from https://nodejs.org/ (keep the default options).
2. Extract this ZIP to a normal folder, e.g. `Desktop\hostel-homes-fullstack`.
3. Open that folder in File Explorer. Click the address bar, type `cmd`, press Enter.
4. Run these commands one at a time:

   ```bat
   copy .env.example .env
   notepad .env
   ```

5. In `.env`, change `JWT_SECRET` to a long random string and change `ADMIN_PASSWORD` to a strong password you will remember. For Neon, add its PostgreSQL connection string as `DATABASE_URL`; leave it empty for local SQLite. Save and close Notepad. The initial admin account is created on the first server start if the configured email does not already exist.
6. In the same Command Prompt run:

   ```bat
   npm install
   npm start
   ```

7. Wait for `Hostel Homes running at http://localhost:3000`, then open **http://localhost:3000** in Chrome.
8. Admin login uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. Register regular User and Owner accounts from the app. Create Owner accounts through the app and add your own property listings.

## What works

- Real registration/login with bcrypt password hashes and signed JWT sessions.
- Role permissions enforced by backend: User, Owner, Admin. Public registration cannot create an Admin.
- Search/filter/sort approved property listings.
- Owners create and edit listings, view enquiries and delete their own listings; owner edits return listings to Pending approval.
- Admins list their own properties or assign listings to registered owners, review and publish/reject listings, manage availability and see overview counts. Admins receive and manage enquiries only for properties they own.
- Room galleries support up to six uploaded JPG/JPEG, PNG or WebP photos or image URLs, with optional photo labels. Both `.jpg` and `.jpeg` are explicitly selectable; JPEG files with an empty or legacy browser MIME type are saved as standard `image/jpeg`. The upload limit is 1.4 MB per file.
- Select up to three rooms and compare rent, deposit, first-month costs, location, preference, availability and amenities. Selections stay available while filtering, and the comparison refreshes listing details before opening. Selections reset when the page reloads.
- Room details show first month's rent plus deposit as a move-in estimate. Other charges must be confirmed with the owner.
- Share a direct room link with friends or family using **Share room**. A shared `/?room=123` link opens the public room details. Copying supports manual selection if clipboard access is unavailable.
- Users save/unsave favourites, view owner contact details, call/email owners directly and send enquiries to the listing owner’s dashboard. Only the relevant owner can update an enquiry’s status.
- Owners and admins can optionally pin a property's location on an OpenStreetMap map. Saved pins appear in room details; unpinned rooms link to the locality instead. No map API key is required.
- In Add/Edit property, the **Property location (optional)** map is always visible directly below City and Locality. Click the map or use **Use map centre**, then save. Existing rooms need an owner-selected pin before room details display an embedded map.
- Owner and Admin dashboards include a separate **Property map** above their listing controls. Owners see their listings; admins see all listings. Numbered saved pins show listing details and an **Edit listing** action. Listings without saved pins are counted but receive no invented markers; the empty map starts around Pune until locations are added.
- Private in-app alerts: admins receive listing review requests, owners receive enquiries and listing decisions, and students receive enquiry status updates. The Alerts button shows unread updates and supports marking them as read.
- Optional transactional email alerts through Brevo's HTTPS API, with a database-backed outbox and retries.
- Data stored in PostgreSQL when `DATABASE_URL` is configured, or SQLite for local development.
- Responsive white interface with square cards and controls, crisp borders, readable sans-serif type, and green accents across browsing, login and account workspaces.

## Important notes

- The deployed site is https://hostel-homes.onrender.com/. Local changes reach it only after pushing to the branch Render deploys and deploying that commit.
- No payments, identity verification, SMS notifications or radius search are included. Photo uploads, map pins and notifications use the configured database. Uploaded photos are currently stored as data URLs and count toward database storage.
- Render Free loses local SQLite files on restarts, redeploys and idle shutdowns. Use Neon via `DATABASE_URL` to retain data independently of the web service. Production/Render startup refuses a missing database URL, and a failed PostgreSQL connection never falls back to SQLite. See [Render's storage limits](https://render.com/docs/free#local-files-lost-on-redeploy).
- Keep `.env` private. Do not publish the admin password or JWT secret.
- If the database is first created before changing `.env`, the admin account is only auto-created if absent. If you need to reset local data, stop the server and back up/delete `hostel-homes.sqlite` (this deletes local app data).
- Keep database backups. Moving to Neon cannot recover data already lost from Render's temporary filesystem.

## Connect Neon and deploy on Render

1. In Neon, create a PostgreSQL project, click **Connect**, leave **Connection pooling** enabled and copy the `postgresql://...` URL.
2. Add `DATABASE_URL=your-full-connection-string` to your private local `.env`. Do not commit it. The backend verifies TLS certificates for Neon's connection string.
3. Run `npm install`. If preserving an existing SQLite database, migrate it **before the first PostgreSQL server start**:

   ```bat
   npm run db:migrate
   ```

   Or use `npm run db:migrate -- "C:\path\to\hostel-homes.sqlite"`. The command takes a consistent SQLite snapshot under the ignored `.backend-check/migration-backups/` folder, keeps the source unchanged, and imports accounts/password hashes, rooms/photos/map pins, favourites, enquiries and notifications in one transaction. It refuses a destination that already contains app records, so rerunning it cannot overwrite existing data. A fresh project without existing data can skip this import.
4. Run `npm run test:postgres` to check real PostgreSQL flows using disposable, uniquely named test schemas. Tests never modify the public app tables or send emails. Then run `npm start` locally and check `/api/health`: `database` should be `PostgreSQL`.
5. Add the same **DATABASE_URL** under the Render service's **Environment** settings. Keep `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` and optional Brevo settings configured there too; Render does not receive your local `.env` from GitHub.
6. Merge the backend change into the branch Render deploys, then deploy. Existing site data that only lives on Render must be exported **before** redeployment and imported into an empty PostgreSQL database; a local SQLite snapshot only contains the records saved locally.

Starting the server creates or upgrades the app tables without clearing records. The initial admin is inserted only if its email is absent; an existing account's password and role are preserved. Neon owns the saved data, so future Render restarts and deploys do not reset listings. Monitor your Neon plan's storage and compute limits as usage grows.


## Node.js 26 compatibility

This package uses `pg` for PostgreSQL and Node.js built-in `node:sqlite` for local development/imports, so `npm install` does not need to compile a native SQLite addon. Use Node.js 22.16+ (including Node.js 26).

## Verify the local backend

Run `npm test` for offline checks against temporary SQLite databases. Run `npm run test:postgres` with `DATABASE_URL` in `.env` to run the same account, listing, approval, search, gallery, map, favourite, enquiry, notification and restart checks against real PostgreSQL as well. PostgreSQL tests create and remove only their own `hh_test_...` schemas using a direct connection. Import checks cover existing IDs, password hashes, photos, sequences, repeat-import refusal and rollback on invalid data. Email API responses are mocked; tests do not send real emails.

Use `http://localhost:3000` for the site and `http://localhost:3000/login` for login. Both pages call the same server's `/api` routes, so no separate frontend server or API URL is needed. The health check is `http://localhost:3000/api/health`.

In Admin → Add property, My property is selected by default. Select a registered Property owner instead when posting on someone else's behalf. Students contact the selected owner, and only that owner can read or update the enquiry. Existing admin-owned listings use that admin’s contact details and personal property inbox.

## Set up email alerts

Use [Brevo transactional email](https://developers.brevo.com/docs/send-a-transactional-email) for account-specific notifications. FormSubmit forwards submitted forms to a configured email address; Brevo lets this backend deliver each update to the relevant owner or student. The integration uses HTTPS because [Render Free blocks common SMTP ports](https://render.com/docs/free#other-limitations).

1. Create a Brevo account, complete any required account activation, and add and verify a sender email address. Authenticate your own sending domain if you have one.
2. Generate a Brevo **API key** (not an SMTP password).
3. Add these values to `.env` locally, or to your Render service's **Environment** settings online:

   ```dotenv
   BREVO_API_KEY=your-brevo-api-key
   EMAIL_FROM=your-verified-sender@example.com
   APP_URL=https://hostel-homes.onrender.com
   ```

4. Restart locally or deploy on Render. Submit an owner listing, publish it as admin, send a student enquiry, then change its status as owner to check the relevant account's Alerts panel and email inbox. Check Brevo's transactional logs if email is missing.

Leave `BREVO_API_KEY` and `EMAIL_FROM` empty for in-app alerts only. Never commit real keys or share them in chat. `APP_URL` is the public website URL used in emails; use `http://localhost:3000` for local-only links.

The outbox processes up to 10 queued alerts every 30 seconds while the server is running. Failed sends retry after five minutes, stopping after three attempts; they remain available in-app. Configuring email later will also send previously queued alerts. Provider acceptance is recorded, but final inbox delivery depends on Brevo, its sending limits and recipient mail servers. A sleeping Render service pauses the email worker.

Maps load [OpenStreetMap's standard tiles](https://operations.osmfoundation.org/policies/tiles/) when opened. Attribution stays visible. For substantial traffic, use a suitable commercial tile service or your own tile hosting.
