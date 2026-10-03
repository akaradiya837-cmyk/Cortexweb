# CortexWeb

CortexWeb is a no-code website builder prototype for independent businesses and creators. It brings editable multi-page websites, publishing, and visitor inquiry capture into one workspace. The current MVP focuses on the full loop: create a project, build and publish a site, then review form submissions in the Leads inbox.

See [STARTUP-PITCH.md](STARTUP-PITCH.md) for the problem hypothesis, target users, business model assumptions, validation plan, and a short presentation pitch.

## Run locally

Requirements: Node.js 24 or newer and a running MySQL 8 server. Website data is stored in MySQL; SQLite is used only by the optional one-time migration script.

```powershell
npm install
Copy-Item .env.example .env
```

Create the MySQL database and application user (replace the example password):

```sql
CREATE DATABASE cortexweb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cortexweb_app'@'127.0.0.1' IDENTIFIED BY 'choose-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON cortexweb.* TO 'cortexweb_app'@'127.0.0.1';
```

Set the matching values in `.env`, then start the app:

```powershell
npm start
```

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env` with your mail provider's SMTP details. Port 587 with `SMTP_SECURE=false` is typical for STARTTLS; port 465 generally uses `SMTP_SECURE=true`. Open `http://localhost:3000`, create an account, verify the emailed code, choose a template, add a contact form, and publish. The server creates the required InnoDB tables in the configured database on first start. Keep `.env` private.

### Import existing SQLite data

The importer preserves IDs, timestamps, and foreign-key relationships. It never deletes or modifies the SQLite file and refuses to import into a MySQL database that already contains application records.

1. Configure `.env` for an empty MySQL database.
2. Run `npm run migrate:sqlite` from the project folder.
3. Start the app with `npm start` and verify the imported accounts and projects.

## MVP capabilities

- Account registration with email OTP verification, server-side scrypt password hashing, session cookies, and CSRF checks; login uses email and password.
- Project creation, builder templates, multiple pages, editable sections, preview, and persistent website content.
- Public website routes at `/site/{slug}` with contact form submissions stored in MySQL.
- Owner-scoped Leads inbox with search across contacts, projects, and messages.
- Activity history, workspace project metrics, and demo-only database integration records.

The dashboard reports actual workspace counts. There are no seeded demo accounts or fabricated revenue/connection metrics.

## Known prototype limits

- The page/section editor currently keeps some in-progress edits in browser storage; verify persistence after refresh before relying on it for a live customer site.
- Public contact forms are not protected by rate limits or spam moderation.
- No custom domains, general email notifications, password reset, payment processing, AI generation, real database integrations, or managed cloud hosting are implemented. OTP challenges are held in memory and are limited to a single server process.
- The local server's in-memory sessions and default development secret are not production deployment settings. Use HTTPS, a persistent session store, configured secrets, backups, and operational monitoring before exposing it publicly.
- The published site is served by the same Node application and MySQL database; it is a functional local demo, not a production hosting service.

## Verification

```powershell
node --check .\app.js
node --check .\server.js
node --check .\database.js
node --check .\scripts\migrate-sqlite-to-mysql.js
```
