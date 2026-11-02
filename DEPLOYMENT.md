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

The FTP account shown in hPanel is already scoped to this site's
`/public_html` document root, so the workflow uploads to the account root
(`./`). Use an FTP account scoped to this site. Credentials belong only in
GitHub Actions secrets, not in this repository.

The deployed `.htaccess` file routes unknown paths to `index.html` so the
client-side `/admin` route continues to load when refreshed.
