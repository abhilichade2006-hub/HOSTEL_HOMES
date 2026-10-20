# Hostel Homes — Full-stack working prototype

A real local backend (Express + SQLite), password-hashed accounts, JWT login, server-enforced roles, property listings, admin approval, favourites and booking enquiries. The SQLite database is stored in `hostel-homes.sqlite` and persists between restarts.

## Start on Windows

1. Install **Node.js 20 LTS or newer** from https://nodejs.org/ (keep the default options).
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
8. Admin login uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. Register regular User and Owner accounts from the app. A sample Owner account is seeded for testing: `sample.owner@hostelhomes.local` / `SampleOwner123!`.

## What works

- Real registration/login with bcrypt password hashes and signed JWT sessions.
- Role permissions enforced by backend: User, Owner, Admin. Public registration cannot create an Admin.
- Search/filter/sort approved property listings.
- Owner creates listings, views their listings and enquiries, deletes their own listings; edits through API return listing to Pending approval.
- Admin reviews and approves/rejects listings, sees overview counts and updates enquiry status.
- Users save/unsave favourites and send booking enquiries.
- Data stored in SQLite database file, shared by app sessions on this computer.
- Responsive browser UI.

## Important notes

- This is a locally runnable full-stack prototype, **not deployed to the public internet**. To share it online, deploy the server and persistent database to a hosting provider and set production secrets/HTTPS.
- Sample property data is illustrative and not verified real accommodation. No payments, identity verification, email/SMS notifications, map/radius search, or image uploads are included. An optional image URL can be entered in a listing.
- Keep `.env` private. Do not publish the admin password or JWT secret. Do not use the sample Owner password for a public deployment.
- If the database is first created before changing `.env`, the admin account is only auto-created if absent. If you need to reset local demo data, stop the server and back up/delete `hostel-homes.sqlite` (this deletes local app data).
- SQLite is suitable for a local demo/small prototype. For a public multi-user production deployment, use a managed database, HTTPS, backups, rate limiting, and a proper hosting setup.


## Node.js 26 compatibility

This package uses Node.js built-in `node:sqlite` instead of `better-sqlite3`, so `npm install` does not need to compile a native SQLite addon. Use Node.js 22.13+ (including Node.js 26).
