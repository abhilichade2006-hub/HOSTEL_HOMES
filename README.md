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
- Admins assign listings to registered owners, review and publish/reject listings, manage availability and see overview counts. Admins do not receive or manage student enquiries.
- Room galleries support up to six uploaded photos or image URLs, with optional photo labels.
- Users save/unsave favourites, view owner contact details, call/email owners directly and send enquiries to the listing owner’s dashboard. Only the relevant owner can update an enquiry’s status.
- Data stored in SQLite database file, shared by app sessions on this computer.
- Responsive browser UI.

## Important notes

- This is a locally runnable full-stack prototype, **not deployed to the public internet**. To share it online, deploy the server and persistent database to a hosting provider and set production secrets/HTTPS.
- No payments, identity verification, email/SMS notifications or map/radius search are included. Photo uploads are stored with listing data in SQLite.
- Keep `.env` private. Do not publish the admin password or JWT secret.
- If the database is first created before changing `.env`, the admin account is only auto-created if absent. If you need to reset local data, stop the server and back up/delete `hostel-homes.sqlite` (this deletes local app data).
- SQLite is suitable for a small deployment. For a public multi-user production deployment, use a managed database, HTTPS, backups, rate limiting, and a proper hosting setup.


## Node.js 26 compatibility

This package uses Node.js built-in `node:sqlite` instead of `better-sqlite3`, so `npm install` does not need to compile a native SQLite addon. Use Node.js 22.13+ (including Node.js 26).

## Verify the local backend

Run `npm test`. The integration test starts a separate server with a temporary SQLite database, checks authentication, permissions, room publishing, photos, filters, favourites and enquiry updates, then restarts the server to verify persistence. It does not modify your normal database.

Use `http://localhost:3000` for the site and `http://localhost:3000/login` for login. Both pages call the same server's `/api` routes, so no separate frontend server or API URL is needed. The health check is `http://localhost:3000/api/health`.

Existing listings attached to an Admin account must be assigned to a registered Property owner through Admin → Edit before students can contact the owner or send an enquiry. Reassigning the listing also moves its existing enquiries to the selected owner’s dashboard.
