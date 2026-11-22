# Hostel Homes — Full-stack working prototype

A real local backend (Express + SQLite), password-hashed accounts, JWT login, server-enforced roles, property listings, admin approval, favourites and booking enquiries. The SQLite database is stored in `hostel-homes.sqlite` and persists between restarts.

## Start on Windows

1. Install **Node.js 22.13 or newer** from https://nodejs.org/ (keep the default options).
2. Extract this ZIP to a normal folder, e.g. `Desktop\hostel-homes-fullstack`.
3. Open that folder in File Explorer. Click the address bar, type `cmd`, press Enter.
4. Run these commands one at a time:

   ```bat
   copy .env.example .env
   notepad .env
   ```

5. In `.env`, change `JWT_SECRET` to a long random string and change `ADMIN_PASSWORD` to a strong password you will remember. Save and close Notepad. The initial admin account is created on the first server start if the configured email does not already exist.
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
- Optional transactional email alerts through Brevo's HTTPS API, with a local SQLite outbox and retries.
- Data stored in SQLite database file, shared by app sessions on this computer.
- Responsive white interface with square cards and controls, crisp borders, readable sans-serif type, and green accents across browsing, login and account workspaces.

## Important notes

- The deployed site is https://hostel-homes.onrender.com/. Local changes reach it only after pushing to the branch Render deploys and deploying that commit.
- No payments, identity verification, SMS notifications or radius search are included. Photo uploads, map pins and notifications are stored in SQLite.
- Render Free loses local SQLite files on restarts, redeploys and idle shutdowns. A persistent database or a paid service with a persistent disk covering the database location is required to retain app data online. See [Render's storage limits](https://render.com/docs/free#local-files-lost-on-redeploy).
- Keep `.env` private. Do not publish the admin password or JWT secret.
- If the database is first created before changing `.env`, the admin account is only auto-created if absent. If you need to reset local data, stop the server and back up/delete `hostel-homes.sqlite` (this deletes local app data).
- SQLite is suitable for a small deployment. For a public multi-user production deployment, use a managed database, HTTPS, backups, rate limiting, and a proper hosting setup.


## Node.js 26 compatibility

This package uses Node.js built-in `node:sqlite` instead of `better-sqlite3`, so `npm install` does not need to compile a native SQLite addon. Use Node.js 22.13+ (including Node.js 26).

## Verify the local backend

Run `npm test`. The integration test starts a separate server with a temporary SQLite database and checks authentication, permissions, room publishing, photos, removed rating routes, map coordinates, favourites, enquiries and private notifications, then restarts the server to verify persistence. Room tools, listing forms, map picker and email queue tests run separately; email API responses are mocked. Tests do not modify your normal database or send real emails.

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
