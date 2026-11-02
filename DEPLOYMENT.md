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

For local development, start the PHP API from a second terminal with
`php -S 127.0.0.1:8001 -t public`; Vite proxies `/api` requests to it. Create a
local `private/admin-auth.php` using the same structure above for local
sign-in. The `private/` directory is ignored by Git.

The CRM's current patient, inventory, and order records remain demo data held
in browser memory; this login does not make those records persistent or turn
the current frontend into a compliant patient-record system. Do not enter real
patient or payment data until the application has a protected server-side data
API and appropriate operational safeguards.
