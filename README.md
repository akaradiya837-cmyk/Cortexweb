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

Generate the encryption key for external MySQL credentials:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the printed value in `DATABASE_ENCRYPTION_KEY` in `.env`, then start the app:

```powershell
npm start
```

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env` with your mail provider's SMTP details. Port 587 with `SMTP_SECURE=false` is typical for STARTTLS; port 465 generally uses `SMTP_SECURE=true`. Open `http://localhost:3000`, create an account, verify the emailed code, choose a template, add a contact form, and publish. The server creates the required InnoDB tables in the configured database on first start. Keep `.env` private.

The Database access page supports two hosting modes: CortexWeb-hosted MySQL databases and users' own MySQL servers. External servers must use a hostname with public IPv4 DNS and a valid TLS certificate, and the supplied account must be allowed to create databases and tables.

To enable CortexWeb-hosted databases, configure `HOSTED_MYSQL_HOST`, `HOSTED_MYSQL_PORT`, `HOSTED_MYSQL_USER`, `HOSTED_MYSQL_PASSWORD`, `HOSTED_MYSQL_SSL`, and `HOSTED_MYSQL_USER_HOST` in `.env`. The hosted MySQL account is a privileged server-side provisioner: it must create databases and users, and grant database-scoped table privileges. Use a dedicated account, restrict its host to the CortexWeb server, and enable TLS for remote MySQL hosts. CortexWeb creates a separate schema and randomly generated database user for each hosted database; it encrypts that user's password at rest. Hosted database creation fails with a configuration error until these server settings are configured.

All stored connection passwords are AES-256-GCM encrypted using `DATABASE_ENCRYPTION_KEY`; keep that key stable and private, and back it up securely because stored credentials cannot be decrypted without it. MySQL tables can be managed inside the dashboard and imported/exported as JSON or CortexWeb-generated SQL. These tables are not exposed to published websites.

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
- Activity history, workspace project metrics, and a MySQL database manager with table and row editing, plus JSON/SQL import and export.

The dashboard reports actual workspace counts. There are no seeded demo accounts or fabricated revenue/connection metrics.

## Known prototype limits

- When connected to the backend, page and section edits are saved to MySQL. Standalone/offline mode uses browser storage instead; verify the save indicator and reload behavior before relying on a live customer site.
- Public contact forms are not protected by rate limits or spam moderation.
- No custom domains, general email notifications, password reset, payment processing, AI generation, other database providers, published-website database API, or managed cloud hosting are implemented. Database connections require a public IPv4 route and trusted TLS. Table listing is limited to 500 rows; import/export is limited to 5,000 rows and exports to 900 KB. SQL imports accept only CortexWeb-generated table dumps. OTP challenges are held in memory and are limited to a single server process.
- The local server's in-memory sessions and default development secret are not production deployment settings. Use HTTPS, a persistent session store, configured secrets, backups, and operational monitoring before exposing it publicly.
- The published site is served by the same Node application and MySQL database; it is a functional local demo, not a production hosting service.

## Verification

```powershell
npm test
node --check .\app.js
node --check .\server.js
node --check .\database.js
node --check .\scripts\migrate-sqlite-to-mysql.js
```
