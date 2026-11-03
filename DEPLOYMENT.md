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

Before using `/admin` on Hostinger, set the GitHub Actions secret
`ADMIN_PASSWORD_HASH`. On a trusted computer with Node.js and PHP installed,
run `node scripts/create-admin-hash.mjs` in an interactive terminal and enter
a unique password of at least 12 characters. The script does not echo the
password. Add its generated hash as the repository Actions secret
`ADMIN_PASSWORD_HASH`; never add the password or hash to source code or a
workflow variable. The deployment workflow installs the config at
`/domains/ambienta.io/private/admin-auth.php`, outside `public_html`.

The initial administrator email is `afosterofficial@gmail.com`; after first
sign-in, the administrator can change it from **Profile & security**. Confirm
that Hostinger PHP 8.1+ and HTTPS are active, then push to `main` or run the
deployment workflow manually. After the private-config deployment succeeds,
open `https://ambienta.io/admin` and sign in.

Administrators and operators can update their display name, sign-in email, and
password from **Profile & security** in the admin sidebar. The current password
is required to save changes; new passwords must be at least 12 characters.
Profile changes are stored in the application database, so changing the
`ADMIN_PASSWORD_HASH` deployment secret does not overwrite an already-created
admin profile. If the primary administrator loses access, generate a new hash
with `node scripts/create-admin-hash.mjs` on a trusted computer and update the
`admin_profile.password_hash` value for account `id = 1` using Hostinger's
protected database administration tools. Never paste passwords or hashes into
chat, source control, or deployment logs.

The login is intentionally unavailable until this private server-side config
exists. If the deployment is served without PHP, the API will not run and the
panel will stay locked; do not replace it with a password check in frontend
JavaScript.

## Contact leads and order database

The PHP data API at `public/api/data.php` stores contact-only leads and
storefront orders in MySQL. It creates its tables and initial catalog records
when first accessed. The database user must have permission to create tables,
read/write rows, and update inventory.

Set the repository Actions secret `APP_CONFIG_JSON_B64` to a base64-encoded
JSON object containing the database settings from hPanel:

```json
{
  "db_host": "YOUR_DATABASE_HOST",
  "db_name": "YOUR_DATABASE_NAME",
  "db_user": "YOUR_DATABASE_USER",
  "db_password": "YOUR_DATABASE_PASSWORD"
}
```

Generate the base64 value locally and add it as a GitHub Actions secret; do
not put database credentials in source code or a normal Actions variable. The
deployment workflow installs the generated `app-config.php` alongside
`admin-auth.php` in `/domains/ambienta.io/private/`, outside `public_html`.
Enable PHP's `pdo_mysql` extension in hPanel before deploying. Once installed,
the admin data API creates the tables and seeds initial catalog prices/stock.
Verify the Leads and Orders sections load successfully before accepting real
orders.

The API persists contact leads, the public product catalog and stock counts,
storefront orders, fulfillment tracking, fulfillment-only internal order notes,
and an admin audit log. Cancelling an order restores its reserved stock exactly
once. Do not put clinical, prescription, insurance, or payment-card details in
order notes. The live CRM workspace shows operational data only: overview
metrics, searchable/paginated orders, products and stock, contact leads,
integration status, staff access, and audit history. Manual orders use current
catalog pricing and reserve stock in the database; their payment status remains
pending and creating an order does not charge a customer.

Products can be imported from **Products & stock > Bulk CSV Upload**. Use the
downloadable template; `name`, `category`, `sku`, `price`, and `stock_count` are
required, while description, dosage, stock threshold, prescription flag, cost,
copay, NDC, and image URL are optional. Imports are limited to 500 rows, check
for duplicate SKUs, require categories to exist first, and are committed as one
database transaction so a failed batch is not partially saved. Categories
added in the inventory workspace are shared with product forms, price filters,
the public storefront, and order items.

Contact lead CSV imports accept `first_name`, `last_name`, `email`, and optional
`phone` and `marketing_consent`. Imported leads start at **Cold**; marketing
consent is false unless the CSV explicitly contains an affirmative value
(`yes`, `true`, `1`, or `opted in`). Do not infer consent from possession of an
email address. Lead profiles support manual stages (Cold, Contacted, Qualified,
Customer, Inactive), consent changes, and order history matched by email,
including fulfillment status and tracking details. Order activity does not
change the manually managed lead stage; update it from the profile when
appropriate. Profiles also allow staff to add or correct a phone number, open
the phone dialer with click-to-call, and add internal comments. Stage changes
save immediately and appear in a dedicated history with the previous and new
stage, acting staff member, and timestamp. Phone edits are also audited;
comments retain their author and timestamp. Notes are operational only: never
enter health, prescription, insurance, payment-card, or other sensitive
personal information.

The Leads table includes a **Not called, repeat buyers** view for contacts with
no recorded call activity and at least two non-cancelled orders. Its order
count excludes cancelled orders; the **All leads** view continues to show total
order history.

The CRM seeds 20 clearly labeled synthetic demo contacts for interface testing.
Their addresses use the reserved `example.com` domain, their phone numbers are
fictional, and they have no marketing consent. They are not actual prospects or
customers; remove them before relying on CRM counts for business reporting.

The primary administrator can create operator accounts from **Staff access**.
Each operator receives a temporary password, which is stored as a password
hash and must be changed on first sign-in. Share temporary passwords through a
secure out-of-band channel. Operators can manage operational orders, products,
and contact leads; only the primary administrator can manage staff accounts or
view the audit log. Deactivated operator accounts are denied access on their
next protected API request.

Mail is not connected: lead profiles can compose a message and hand it off to
the staff member's default email application, but the CRM does not send
messages or track delivery, opens, or replies. Staff must verify that a message
is lawful to send; do not use the composer for promotional outreach without
recorded marketing opt-in. Card and PayPal processing are disabled, and
cryptocurrency remains disabled. The audit log is available only through the
authenticated admin API.

Storefront checkout currently accepts cash on delivery/pickup only. Card,
PayPal, and cryptocurrency processing are disabled until a server-side payment
provider is configured; no payment is captured by this API. To enable payment
or mailbox features, configure provider credentials only through protected
server/GitHub Actions secrets and complete provider webhook, delivery, and
security verification before representing those integrations as active.

For local development, start the PHP API from a second terminal with
`php -S 127.0.0.1:8001 -t public`; Vite proxies `/api` requests to it. Create
local `private/admin-auth.php` and `private/app-config.php` files using the
structures above for local sign-in and database testing. The `private/`
directory is ignored by Git. Local testing also requires PHP's `pdo_mysql`
extension.

This login and limited database API do not turn the frontend into a compliant
patient-record system. Do not enter real patient, prescription, or payment
card data.
