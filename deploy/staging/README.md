# Cloudflare staging

Static assets only, on `studio.griffpatch.academy` and the retained
`griffpatch-studio-staging.griffpatch.workers.dev` address. The custom-domain
route is source-controlled in `wrangler.jsonc`; Cloudflare manages its DNS and
TLS certificate. No Worker request handler, database, analytics binding or paid
caching product is configured. Workers observability is disabled.

Build using the repository README (including modified Blocks), then copy
`deploy/staging/_headers`, `deploy/staging/_redirects` and
`deploy/staging/robots.txt` into `build/`. The explicit root redirect keeps
the editor at `/editor.html` without rewriting missing JS requests into HTML.
Run pinned Wrangler 4.122.0 with `CLOUDFLARE_ACCOUNT_ID` set to the intended account:

```powershell
npx wrangler@4.122.0 deploy --config deploy/staging/wrangler.jsonc --dry-run
npx wrangler@4.122.0 deploy --config deploy/staging/wrangler.jsonc
```

Check the account and whether that Worker already exists before deploying. A
subsequent deploy replaces this staging site, not the production hostname.
Capture the deployment version and source revision. Roll back an update using
`wrangler rollback <previous-version> --config deploy/staging/wrangler.jsonc`.
For the initial deployment, disabling its workers.dev route takes it offline;
there is no previous version to roll back to. Do not delete unrelated Workers.

The staging address is **public, not password protected**. The noindex header and
robots.txt discourage indexing; they are not access control. Use disposable test
projects and do not announce it as the production service. The custom domain
creates one Studio DNS record and certificate. The Academy apex currently sets a
Cloudflare security cookie scoped to griffpatch.academy; browsers may therefore
send it to the Studio subdomain. The application does not read it. The workers.dev
address remains useful for isolated comparison.

Cloudflare receives request metadata to serve and protect the site. Disabling
application observability does not disable Cloudflare's infrastructure/security
processing or prove that it retains no logs. No Studio-specific retention period
is invented here. The application's preview notice describes inherited external
services and browser storage; this staging setup is not final privacy clearance.
