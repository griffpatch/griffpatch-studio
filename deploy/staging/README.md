# Cloudflare staging

Static assets only, on `griffpatch-studio-staging.griffpatch.workers.dev`.
No custom-domain route, Worker request handler, database, analytics binding or
paid caching product is configured. Workers observability is disabled.

Build using the repository README (including modified Blocks), then copy
`deploy/staging/_headers` and `deploy/staging/robots.txt` into `build/`.
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
projects and do not announce it as the production service. Existing Academy DNS,
Workers and cookies are not changed. Hosting on workers.dev also keeps Academy
parent-domain cookies out of these staging requests. Final-domain cookie and
privacy checks still need to happen before launch.

Cloudflare receives request metadata to serve and protect the site. Disabling
application observability does not disable Cloudflare's infrastructure/security
processing or prove that it retains no logs. No Studio-specific retention period
is invented here. The application's preview notice describes inherited external
services and browser storage; this staging setup is not final privacy clearance.
