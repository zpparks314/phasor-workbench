# Deployment

**Status: repository prepared; no public deployment verified.** This is the
canonical guide for deploying and operating Phasor Workbench. Milestone 5 stays
open until the public deployment and its exit criteria have been verified.

The setup order is deliberate:

1. Prepare and validate the repository without a Render URL.
2. Create the Render backend service and obtain its real HTTPS origin.
3. Configure and deploy the production frontend, then verify the complete site.

Normal CI, tests, and local builds do not require a production URL. Only the
production Pages workflow requires one. No secrets belong in committed files.

## Architecture

```text
phasor.zacharyparks.site
        |
        v
GitHub Pages
React/Vite frontend
        |
        | HTTPS API: /api/v1/*
        v
Render
FastAPI/Qiskit compute service
```

GitHub Pages serves static files and cannot execute Python. Render runs the
existing backend package, including analysis, OpenQASM import/export, examples,
and simulation. The browser calls its HTTPS origin directly; there is no
production `/api` proxy on Pages.

This follows the existing frontend/backend boundary in
[Architecture.md](Architecture.md). The Circuit Model and simulator interface
do not change. Circuit storage remains in the browser; the backend has no
database or persistent disk. Production uses native builds, while the existing
Dockerfiles and Compose remain development tools.

## Local development

Follow [README: Getting Started](../README.md#getting-started) for native setup
or Docker. With the backend virtual environment active, start the backend from
`backend/`:

```sh
uvicorn phasor_workbench.main:app --reload --port 8000
```

From `frontend/`, run `npm run dev`. Open `http://localhost:5173`.
The default empty `VITE_API_BASE_URL` sends `/api/v1/*` to Vite, which proxies
`/api` to `http://localhost:8000`. Compose supplies `VITE_PROXY_TARGET` for its
backend container. That variable configures the dev server process, not the
production browser bundle.

The existing `.env.example` files describe local defaults. Copies named `.env`
are ignored by Git. Neither creating `.env` nor supplying a Render URL is
required for tests or `npm run build`.

| Setting | Local development | Production |
|---|---|---|
| `VITE_API_BASE_URL` | Empty; use Vite's proxy | Actual HTTPS backend origin, without `/api/v1` |
| `VITE_USE_MOCK_API` | `false`; opt in only for frontend development | Explicitly `false` in the Pages build |
| `QW_CORS_ORIGINS` | Defaults to `["http://localhost:5173"]` | `["https://phasor.zacharyparks.site"]` on Render |
| `PORT` | Uvicorn's local `--port 8000` | Supplied by Render; used by the start command |
| `PYTHON_VERSION` | Installed supported Python | Explicit Render runtime version in `render.yaml` |

Vite embeds `VITE_*` values at **build time**. They are public browser code, not
secrets; changing the API origin requires rebuilding and publishing the
frontend. Backend `QW_*` settings are read when the process starts. The existing
prefix is preserved for compatibility.

## Backend deployment: Render

The root [render.yaml](../render.yaml) makes the service configuration
reviewable and repeatable. Creating a Blueprint from it is a deployment action;
merely committing the file does not provision anything. Review its service name,
branch, region selection, and compute tier before applying it. It selects the
free tier for initial evaluation; choose an appropriate tier before release.

Use a **Python Web Service**, not a static site. The same configuration can be
entered manually if not using a Blueprint:

| Setting | Value |
|---|---|
| Branch | `main` |
| Root directory | `backend` |
| Build command | `pip install ".[simulation]"` |
| Start command | `uvicorn phasor_workbench.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/v1/health` |
| `PYTHON_VERSION` | `3.14.3`, explicitly pinned in `render.yaml` |
| `QW_CORS_ORIGINS` | `["https://phasor.zacharyparks.site"]` |
| Automatic deployment | Off initially (`autoDeployTrigger: off`) |

The build installs the actual package from `backend/pyproject.toml`, including
Qiskit and NumPy, without development tools. Its wheel contains the generated
model and bundled `.qasm` examples; production does not need a sibling `shared/`
mount or binding generation. The start command uses the installed package,
binds all interfaces on Render's assigned port, and does not use `--reload`.
One Uvicorn process is the initial configuration.

The Python patch pin should be updated deliberately and verified with the
backend checks. The native CI matrix covers Python 3.11 and 3.14; it does not
pin this exact patch. See Render's
[FastAPI guide](https://render.com/docs/deploy-fastapi),
[Python version configuration](https://render.com/docs/python-version), and
[Blueprint reference](https://render.com/docs/blueprint-spec).

The CORS value is a **JSON array of exact origins**, without trailing slashes.
Do not use `*`. Local development retains its localhost default; production
allows only the configured frontend. If another browser origin must call the
deployed backend, add it deliberately to the array. Credentials remain disabled,
and the middleware permits GET, POST, and JSON request preflights. CORS controls
browser access; it is not authentication or a compute quota.

Once the service exists, copy the HTTPS origin shown by Render. Do not guess its
hostname from the service name. Verify `/api/v1/health` and a small simulation
before configuring Pages. Health is liveness only: it can return `ok` even if
the simulation extra is missing.

### Cold starts and current limits

Render's free service sleeps after 15 minutes without inbound traffic and takes
about a minute to wake. Early requests may therefore be slow or show backend
unavailability; wait for the service to become healthy, then reload or retry.
This is not evidence that the circuit is invalid. Render describes the free
tier as suitable for evaluation rather than production reliability. See its
[free-service limitations](https://render.com/docs/free).

The backend enforces a fixed 20-qubit adapter cap, a configurable 12-qubit
statevector response cap, a shot ceiling, and an OpenQASM source-size ceiling.
There is currently no enforced simulation wall-clock timeout, general request
body limit, or operation-count limit. The reserved settings are not operational
protections. See [Simulation.md](Simulation.md#resource-limits) and
[API.md](API.md#limits) for the implemented limits.

## Frontend deployment: GitHub Pages

[deploy-pages.yml](../.github/workflows/deploy-pages.yml) is separate from
[ci.yml](../.github/workflows/ci.yml). CI and its required aggregate `CI` check
remain unchanged. The Pages workflow initially runs only on manual dispatch,
and its build job accepts only `main`.

After the backend is running:

1. Make the reviewed readiness change available on `main` through the normal PR
   process. Confirm its complete `CI` check passes before publishing.
2. In repository Settings, Pages, select **GitHub Actions** as the build source.
3. Add a repository Actions **variable** named `VITE_API_BASE_URL`, using the
   real HTTPS backend origin. Do not append `/api` or `/api/v1`; the client owns
   that prefix. No URL is committed as a stand-in for the future service.
4. Set the Pages custom domain to `phasor.zacharyparks.site` and configure DNS
   as described below. Restrict the `github-pages` deployment environment to
   `main` as an additional deployment guard.
5. In Actions, run **Deploy GitHub Pages** on `main`.

The workflow rejects a missing or malformed production origin with an explicit
message. This validation is confined to publishing: it is not added to Vite,
the ordinary build script, or normal CI. The workflow uses `npm ci`, runs lint,
format, types and tests, builds with mocks disabled, and uploads `frontend/dist`.
Only a successful build can reach the deploy job. Official `configure-pages`,
`upload-pages-artifact`, and `deploy-pages` actions handle publishing with scoped
permissions and the `github-pages` environment.

Vite uses `base: /` (also passed explicitly in the Pages build) because the final
site is at the custom domain root, not `/phasor-workbench/`. GitHub Actions Pages
deployments configure the custom domain in repository settings; a committed
`CNAME` file is not required and does not configure that setting. See
[Vite's Pages guide](https://vite.dev/guide/static-deploy) and
[GitHub's custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

### Enable automatic deployment after verification

Once production passes the smoke tests, add a `push` trigger alongside
`workflow_dispatch` in `deploy-pages.yml`:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
```

Keep the main-only guard, build checks, environment, and deployment concurrency
settings. This makes every push to protected `main` build, check, and publish
the frontend; retain the required `CI` merge check. The Pages job independently
checks the frontend, but does not wait for the separate post-push backend CI
run. Render automatic deployment is a separate decision: change its trigger to
`checksPass` only when backend automatic deployment is also intended.

## DNS and the custom domain

`zacharyparks.site` is the parent domain. `phasor.zacharyparks.site` is the
subdomain for this application; the parent domain's existing site need not
change.

Configure the custom domain in GitHub Pages first. At the DNS provider, create
the `phasor` CNAME pointing to the repository owner's Pages hostname,
`zpparks314.github.io` (no scheme and no repository path). Confirm the owner if
the repository moves. Do not point this frontend record at Render. Follow
GitHub's domain-verification guidance, allow DNS and certificate provisioning
to finish, then enable **Enforce HTTPS** in Pages settings. Provider-specific
screens depend on whoever hosts the domain's DNS.

GitHub documents the required relationship and setup order in
[Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Deployment verification

Run these against `https://phasor.zacharyparks.site` and the actual Render
service, not just a local dev server:

- Confirm HTTPS, the favicon, scripts, and styles load, including after refresh.
- Check `/api/v1/health` on Render. In browser network tools, confirm API calls
  go to the configured Render origin with no duplicated `/api/v1` or slash.
- Confirm JSON POST preflights succeed from the production origin and there
  are no CORS errors. A GET alone does not prove simulation requests work.
- Load the Bell example. Check exact `00` and `11` probabilities are each 0.5;
  sample 1,024 shots and check only those two outcomes occur and total 1,024.
- Start another circuit: apply X to one qubit and confirm outcome `1` has
  probability 1. This catches accidentally deployed recorded mock results.
- Place and edit gates, undo/redo, and exercise keyboard placement. Save locally
  and refresh; confirm the circuit survives. Localhost and the production domain
  have separate browser storage; use JSON export/import to transfer circuits.
- Round-trip JSON and OpenQASM, and load another built-in example. These check
  both browser file handling and the backend's installed package resources.
- Verify the existing responsive layout and error messages when the backend is
  unavailable. If using a free instance, check recovery after a cold start.
- Complete the human screen-reader check recorded in the Roadmap before closing
  the public-release exit criteria.

Local readiness verification includes the checks in
[README: Running the Checks](../README.md#running-the-checks), a production
frontend build, and loading the application in a browser. A production build
can be checked locally with `npm run preview`; for a real backend connection
build with a local backend origin and allow the preview origin through
`QW_CORS_ORIGINS`. This is a temporary local test configuration, not a production
URL to commit.

## Operation and recovery

Inspect GitHub Actions logs for build/publishing failures and Render logs for
startup or API failures. Check the configured origin and CORS allowlist before
debugging the circuit. After changing backend settings, restart/redeploy the
service; after changing `VITE_API_BASE_URL`, rerun the frontend deployment.

Keep the last verified frontend and backend commit identifiers together in
release notes. To recover from a faulty release, revert through the normal PR
process and publish the corrected `main`, or use Render's rollback facility for
the backend while preparing the correction. Re-run the smoke tests after either
side changes. Neither deployment carries server-side user data to migrate.

## Future scaling

This deployment targets early usage and small simulations. Observe actual
latency and memory use before choosing larger compute or additional execution
infrastructure. The simulator/execution abstraction lets compute infrastructure
evolve independently of the frontend as later milestones require it. This work
does not begin those milestones; see [Roadmap.md](Roadmap.md) and
[Simulation.md](Simulation.md).
