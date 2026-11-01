# Controlled production release preflight — canonical quote names

**Prepared 2026-11-01. No deployment authorized or executed.**

## Verified scope

- [PR #9](https://github.com/lobanov0710-blip/uber-v3/pull/9) was merged into `main` as `7fad96a63ac963e6c28bf03f21d52b90e5cb69ff`.
- `src/core/quotes.js` now prefers validated geocoder `displayName` for **new** `quotes.from_place`/`to_place`, falling back to `query`. No existing D1 rows are rewritten.
- Backend [CI run 41296232638](https://github.com/lobanov0710-blip/uber-v3/actions/runs/41296232638) passed. No database migration in PR #9.
- `wrangler.toml` specifies `uber-v3`, D1 binding `DB` → `transfer-servis52-core` (ID `c1d490e4-68f0-4f78-8f53-7d10df7c3395`), KV binding `DRIVERS` (ID `a0b3ddaecec4476f983eb28cc3d8a1e5`).
- GitHub's sole current workflow `.github/workflows/backend-tests.yml` runs tests on PRs and `fix/**` pushes. It **does not** deploy production.
- Previously owner-confirmed production active version `ab6dd14` served **100%** traffic; preview `d1f9f2c7` is a distinct version. **Recheck production immediately before any release**: this evidence may be stale.

**Critical:** Cloudflare's Worker Version ID is not a Git commit SHA. A deployment of `main` publishes the **entire bundle**, which may contain older changes not currently active in production. Unless the currently deployed bundle is fully reconciled against `main`, block deployment. Do not assume that only PR #9 would become live.

## Safe local preflight (PowerShell, no production writes)

The existing checkout `C:\Users\Lobanov\Desktop\uber-v3` is on **`arch/11.16-order-status-push`** at commit `2577329`, not `main`. **Do not checkout, reset, clean or merge into this branch**. Its tracked changes and local `wrangler.staging.toml` must be preserved. The following creates a **separate detached Git worktree** for the exact reviewed production `main` commit.

~~~powershell
$repo = "$env:USERPROFILE\Desktop\uber-v3"
$worktree = "$env:USERPROFILE\Documents\ProjectApp\uber-v3-prod-preflight"
$approved = "7fad96a63ac963e6c28bf03f21d52b90e5cb69ff"

if (-not (Test-Path -LiteralPath $repo)) { throw "Original repository not found" }
git -C $repo fetch origin main
if ($LASTEXITCODE -ne 0) { throw "Git fetch failed" }

$remote = (git -C $repo rev-parse origin/main).Trim()
Write-Host "REMOTE_MAIN=$remote"
if ($remote -ne $approved) {
    throw "main changed since reviewed merge; stop and reassess"
}
if (Test-Path -LiteralPath $worktree) {
    throw "Preflight folder already exists; do not overwrite it"
}

git -C $repo worktree add --detach $worktree origin/main
if ($LASTEXITCODE -ne 0) { throw "Cannot create separate preflight worktree" }

Set-Location $worktree
$head = (git rev-parse HEAD).Trim()
if ($head -ne $approved) { throw "Preflight code does not match approved commit" }
if (@(git status --porcelain).Count -gt 0) { throw "Preflight worktree unexpectedly dirty" }
if (-not (Test-Path ".\wrangler.toml")) { throw "Missing Worker config" }
if (-not (Test-Path ".\package-lock.json")) { throw "Missing lockfile" }

Write-Host "PREFLIGHT_SOURCE=PASS"
Write-Host "ORIGINAL_ARCH_BRANCH=UNTOUCHED"

node --version
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

npm test
if ($LASTEXITCODE -ne 0) { throw "Backend tests failed" }

npx --no-install wrangler deploy --config wrangler.toml --dry-run --outdir .wrangler/preflight-quote
if ($LASTEXITCODE -ne 0) { throw "Wrangler dry-run failed" }

Write-Host "LOCAL_PREFLIGHT=PASS"
Write-Host "PRODUCTION_DEPLOYMENT=NOT_PERFORMED"
~~~

`npm ci` downloads and installs local dependencies; `--dry-run` compiles the bundle locally and does **not** deploy a Worker. `.wrangler/` is ignored by Git. Never print/copy `.env`, `.dev.vars`, or tokens. A Wrangler/Node network failure stops preflight and does not authorize live API requests. CI used Node 22; Windows environment previously reported Node 24.14.1. Tests previously run in the ARCH-11.16 checkout do **not** count as tests of merged `main`; hence this isolated run.

## Cloudflare dashboard verification — read only

In Workers & Pages → `uber-v3`:

1. **Deployments → Active Deployment:** record active version *full ID*, traffic allocation, and rollback candidate. Do not confuse Ready preview with active deployment.
2. **Settings → Bindings:** reconfirm `DB` and `DRIVERS` IDs above. Verify required secret **names** exist, without disclosing contents.
3. **Code/release audit:** compare the actual deployed version/bundle with the full `main` bundle and document all pending differences. The old `ab6dd14` was not identified with a Git source commit. **Block deployment if the source baseline cannot be established.**
4. Do not run D1 migrations, POST `/calculate` or POST `/orders`; do not enable Observability, staging flags, Telegram or FCM.
5. Preserve the known-good version and its binding compatibility for rollback.

## Future deployment — separate approval required

Only after all gates above pass, ask for a **specific new authorization** to deploy the reviewed `main` bundle. The eventual command would be:

~~~powershell
# NOT FOR PREFLIGHT — do not run without deployment approval.
npx --no-install wrangler deploy --config wrangler.toml --message "Canonical quote names, PR #9"
~~~

Following a separately authorized deployment, confirm the new active version and binding IDs; a read-only GET on `https://transfer-servis52.ru/api/calculate.php` should return HTTP 405. GET/405 confirms availability only, **not** that new addresses are saved correctly. Another production quote would itself insert into D1 and needs its own one-time approval. Real production order/Telegram/FCM testing requires an additional explicit order authorization.

## Rollback (emergency only, never part of preflight)

Workers & Pages → `uber-v3` → Deployments → identify the **then-confirmed** last-known-good version (historically `ab6dd14`) → version menu → Rollback. This changes production traffic **immediately**. It does not reverse D1 writes and may be blocked by incompatible/deleted bindings. Refer to [Cloudflare rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Gate log

| Check | Status |
| --- | --- |
| PR #9 merged | PASS |
| Backend CI | PASS |
| D1 migration required | NO |
| Local `npm test` after merge | PENDING |
| Local Wrangler dry-run | PENDING |
| Current active version/bindings reconfirmed | PENDING |
| Full deployed-versus-main bundle audit | PENDING |
| Approval to deploy | **NOT GIVEN** |
| Live deployment | **NOT PERFORMED** |
| Order / Telegram / FCM E2E | **NOT PERFORMED** |
