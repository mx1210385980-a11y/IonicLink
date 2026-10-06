# Production deployment

IonicLink deploys automatically after a verified commit is merged into `main`.
Pull requests run the same verification job but never receive production
credentials and never deploy.

## Production layout

| Path | Purpose |
| --- | --- |
| `/opt/ioniclink-source` | Clean Git checkout used only for Docker builds |
| `/opt/ioniclink-v2/.env.production` | Production environment variables |
| `/opt/ioniclink-v2/data` | Persistent SQLite databases (including `auth.db` and `teaching.db`), sources, and caches |
| `/opt/ioniclink-backups/actions` | Per-deployment environment and SQLite backups |
| `/var/lib/ioniclink-deploy/current-sha` | Currently deployed Git commit |
| `/var/lib/ioniclink-deploy/history.log` | Successful deployment history |
| `/usr/local/sbin/ioniclink-deploy` | Root-owned deployment entrypoint |

The `ionicdeploy` account is not a member of the `docker` group. Its SSH key is
restricted from forwarding and PTY allocation, and sudo permits only the
root-owned deployment entrypoint. The entrypoint rejects malformed SHAs and
commits that are not contained in `origin/main`.

The deployment script verifies that the requested commit belongs to
`origin/main`, creates online SQLite backups, builds the production image, recreates the existing
`ioniclink-frontend` container, checks `http://127.0.0.1/api/auth/get-session`, and rolls back to
the previously deployed commit when the new container fails its health check.
The authentication endpoint is used so a deployment is accepted only after the configured access
mode is usable. It returns an empty session in public compatibility mode, or verifies the auth
configuration and schema when application login is enabled. The backup helper includes every top-level `*.db`, so application accounts
and sessions in `auth.db` and the pseudonymous classroom submissions in `teaching.db` are covered
by the same pre-deployment backup and SQLite integrity check.

## GitHub environment secrets

The `production` environment is restricted to the `main` branch and contains:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

Never commit the deployment private key or `.env.production`.

## Application runtime environment

Application login is opt-in. If both `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are absent, the
workspace remains public and the login route redirects back to the requested workspace. This keeps
existing HTTP/IP deployments operational without installing an insecure default credential.

To enable application login, the server-owned `/opt/ioniclink-v2/.env.production` must define:

- `BETTER_AUTH_SECRET`: a unique random value containing at least 32 characters.
- `BETTER_AUTH_URL`: the public HTTPS origin, for example `https://ioniclink.example.org`.
- `IONICLINK_ALLOW_SIGNUP=false`: the recommended production default.

The first login-enabled deployment also needs `IONICLINK_BOOTSTRAP_EMAIL` and an 8-128 character
`IONICLINK_BOOTSTRAP_PASSWORD`. `IONICLINK_BOOTSTRAP_NAME` is optional. The account is created as
an administrator only when the email does not already exist. After the health check succeeds,
remove the bootstrap password from `.env.production` and recreate the container. Existing accounts
and sessions remain in `auth.db`.

When login is enabled, TLS must terminate at a reverse proxy or load balancer before traffic reaches the exposed container
port. Do not publish the login form over plain HTTP: otherwise credentials and session cookies are
exposed in transit. The reverse proxy must preserve `Host` and send `X-Forwarded-Proto: https`.

When login is enabled, application pages and data APIs require a general application account. In
public compatibility mode they retain the previous open-workspace behavior while cross-origin writes
remain rejected. The `/teaching` lab remains independent. Students choose AI or manual
extraction and receive an automatically generated ID for the most recently created experiment.
The current instructor entry creates a teacher session without checking a password. Neither
application login nor `TEACHING_TEACHER_PASSWORD` protects this entry; restricted teaching
deployments need separate access control. `TEACHING_TEACHER_PASSWORD` is still used by the
retained teaching-session login API.

Before students join, the teacher creates an experiment from an uploaded tribology PDF and
confirms a fixed answer key in `/teaching/admin`. The AI group uses the same live extraction
provider and model configuration as the research workspace. Configure that provider in the
server-owned `.env.production`; AI teaching extraction returns 503 when it is unavailable.
The manual group uploads a completed table and self-recorded time. AI edits are persisted with
**Save draft** or final submission. See [the teaching guide](teaching-lab.md) for scoring,
timing, and saved-progress behavior.

The deploy entrypoint exports the host data directory and mounts it at `/app/data`. Do not put a
host-only path inside the container environment. The login store therefore persists as
`/opt/ioniclink-v2/data/auth.db` on the host and `/app/data/auth.db` in the container; the teaching
store persists as `/opt/ioniclink-v2/data/teaching.db` on the host and `/app/data/teaching.db` in the container.
Authentication schema migrations run automatically before the first auth request, including the
deployment health check. Teaching schema migrations and the current lab's tables initialize
automatically. Experiment creation also stores a source copy under `/app/data/teaching-papers/`.
Preserve this directory together with `teaching.db` when transferring classroom data.

Each experiment's answer key is fixed when the teacher creates it. Create a new experiment for
a changed paper or answer key; the student entry then selects that newest experiment. Existing
teaching tables and valid unfinished crossover sessions remain supported. No domain seed or
manual migration command is required for teaching data.

## Manual deployment

From a server administrator session:

```bash
sudo /usr/local/sbin/ioniclink-deploy FULL_40_CHARACTER_MAIN_COMMIT_SHA
```

## Manual rollback

Read the previous successful SHA from:

```bash
sudo tail -n 2 /var/lib/ioniclink-deploy/history.log
```

Then deploy that SHA through the same audited entrypoint:

```bash
sudo /usr/local/sbin/ioniclink-deploy FULL_40_CHARACTER_PREVIOUS_SHA
```
