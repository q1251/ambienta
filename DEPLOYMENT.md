# Hostinger deployment

The `Deploy to Hostinger` GitHub Actions workflow builds the Vite site and
publishes the contents of `dist/` over FTPS whenever a commit is pushed to
`main`. It can also be started manually from the repository's Actions tab.

Before the first run, add these repository Actions secrets under
**Settings > Secrets and variables > Actions**:

| Secret | Value |
| --- | --- |
| `HOSTINGER_FTP_SERVER` | FTP host shown in Hostinger hPanel |
| `HOSTINGER_FTP_USERNAME` | FTP account username |
| `HOSTINGER_FTP_PASSWORD` | FTP account password |
| `HOSTINGER_SERVER_DIR` | Website document-root directory for that FTP account, ending in `/` |

Use the exact document-root path shown for the site's FTP account; it is often
`public_html/`, but can differ by domain and account. Use an FTP account scoped
to this site's document root. Credentials belong only in GitHub Actions
secrets, not in this repository.

The deployed `.htaccess` file routes unknown paths to `index.html` so the
client-side `/admin` route continues to load when refreshed.
