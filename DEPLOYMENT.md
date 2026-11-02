# Hostinger deployment

The `Deploy to Hostinger` GitHub Actions workflow builds the Vite site and
publishes the contents of `dist/` over FTPS whenever a commit is pushed to
`main`. It can also be started manually from the repository's Actions tab.

Before the first run, add these repository Actions secrets under
**Settings > Secrets and variables > Actions**:

| Secret | Value |
| --- | --- |
| `HOSTINGER_HOST` | FTP host shown in Hostinger hPanel |
| `HOSTINGER_USERNAME` | FTP account username |
| `HOSTINGER_PASSWORD` | FTP account password |

The verified document root for `ambienta.io` is
`/domains/ambienta.io/public_html/`. The workflow uploads there over FTPS.
Credentials belong only in GitHub Actions secrets, not in this repository.

The deployed `.htaccess` file routes unknown paths to `index.html` so the
client-side `/admin` route continues to load when refreshed.

## Admin login setup

The CRM now requires a server-verified PHP session before rendering the admin
panel. The login API is deployed from `public/api/auth.php`. It stores its
session in an HTTP-only, same-site cookie, regenerates the session ID after
login, expires idle sessions after eight hours, and rate-limits failed login
attempts. Do not put an administrator password or its hash in this repository,
the public web root, or GitHub Actions variables.

Before using `/admin` on Hostinger:

1. Confirm the hosting plan has PHP 8.1+ enabled and HTTPS is active for
   `ambienta.io`.
2. In Hostinger File Manager, create the directory
   `/domains/ambienta.io/private/`, alongside `public_html` and outside the
   public web root.
3. On a trusted computer with Node.js and PHP installed, run
   `node scripts/create-admin-hash.mjs` in an interactive terminal. Enter a
   unique password of at least 12 characters. The script does not echo the
   password; copy the resulting hash.
4. Create `/domains/ambienta.io/private/admin-auth.php` with the following
   contents, replacing the hash with the value from the previous step:

   ```php
   <?php
   return [
       'admin_email' => 'afosterofficial@gmail.com',
       'password_hash' => 'PASTE_THE_GENERATED_HASH_HERE',
   ];
   ```

5. Restrict the config file to the hosting account owner (for example, file
   mode `600` if Hostinger exposes Unix permissions), then open
   `https://ambienta.io/admin` and sign in.

The login is intentionally unavailable until this private server-side config
exists. If the deployment is served without PHP, the API will not run and the
panel will stay locked; do not replace it with a password check in frontend
JavaScript.

## Contact leads and order database

The PHP data API at `public/api/data.php` stores contact-only leads and
storefront orders in MySQL. It creates its tables and initial catalog records
when first accessed. The database user must have permission to create tables,
read/write rows, and update inventory.

1. In hPanel, confirm the MySQL database host, database name, username, and
   password. Enable PHP's `pdo_mysql` extension for the site.
2. Create `/domains/ambienta.io/private/app-config.php` alongside
   `admin-auth.php`, outside `public_html`, with the actual values from hPanel:

   ```php
   <?php
   return [
       'db_host' => 'localhost',
       'db_name' => 'YOUR_DATABASE_NAME',
       'db_user' => 'YOUR_DATABASE_USER',
       'db_password' => 'YOUR_DATABASE_PASSWORD',
   ];
   ```

   Replace `localhost` if hPanel lists a different database host. Restrict
   access to this file and never upload it into `public_html` or commit it.
3. After deploying the PHP endpoint, sign in at `/admin`; the admin data API
   creates the tables and seeds catalog prices/stock. Verify the Leads and
   Orders sections load successfully before accepting real orders.

The API persists contact details for leads and fulfillment fields for orders;
it does not store clinical, prescription, insurance, or free-form checkout
notes. The sample clinical CRM, email logs, and inventory editor remain
browser-memory previews and are not part of this database. Storefront checkout
currently accepts cash on delivery/pickup only. Card, PayPal, and
cryptocurrency processing are disabled until a server-side payment provider is
configured; no payment is captured by this API.

For local development, start the PHP API from a second terminal with
`php -S 127.0.0.1:8001 -t public`; Vite proxies `/api` requests to it. Create a
local `private/admin-auth.php` and `private/app-config.php` using the structures
above for local sign-in and database testing. The `private/` directory is
ignored by Git. Local testing also requires PHP's `pdo_mysql` extension.

This login and limited database API do not turn the frontend into a compliant
patient-record system. Do not enter real patient, prescription, or payment
card data.
