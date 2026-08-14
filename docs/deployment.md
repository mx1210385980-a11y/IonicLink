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
The authentication endpoint is used so a deployment is accepted only after the auth configuration
and schema are usable. The backup helper includes every top-level `*.db`, so application accounts
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

The server-owned `/opt/ioniclink-v2/.env.production` must also define:

- `BETTER_AUTH_SECRET`: a unique random value containing at least 32 characters.
- `BETTER_AUTH_URL`: the public HTTPS origin, for example `https://ioniclink.example.org`.
- `IONICLINK_ALLOW_SIGNUP=false`: the recommended production default.

The first deployment also needs `IONICLINK_BOOTSTRAP_EMAIL` and an 8-128 character
`IONICLINK_BOOTSTRAP_PASSWORD`. `IONICLINK_BOOTSTRAP_NAME` is optional. The account is created as
an administrator only when the email does not already exist. After the health check succeeds,
remove the bootstrap password from `.env.production` and recreate the container. Existing accounts
and sessions remain in `auth.db`.

TLS must terminate at a reverse proxy or load balancer before traffic reaches the exposed container
port. Do not publish the login form over plain HTTP: otherwise credentials and session cookies are
exposed in transit. The reverse proxy must preserve `Host` and send `X-Forwarded-Proto: https`.

Application pages and data APIs require a general application account. The `/teaching` experiment
remains independent: students use pseudonymous IDs and the teacher dashboard continues to use
`TEACHING_TEACHER_PASSWORD`.

The server-owned `/opt/ioniclink-v2/.env.production` must define a long, unique
`TEACHING_TEACHER_PASSWORD` before a teacher can open the results dashboard. Students do not use
this password and need only a pseudonymous ID. The teaching experiment uses versioned, frozen AI
suggestions, so it does not require a live OpenAI or Anthropic key; those keys remain optional for
the separate live extraction workflow.

The deploy entrypoint exports the host data directory and mounts it at `/app/data`. Do not put a
host-only path inside the container environment. The login store therefore persists as
`/opt/ioniclink-v2/data/auth.db` on the host and `/app/data/auth.db` in the container; the teaching
store persists as `/opt/ioniclink-v2/data/teaching.db` on the host and `/app/data/teaching.db` in the container.
Authentication schema migrations run automatically before the first auth request, including the
deployment health check. Teaching schema migrations run automatically, and the default experiment
is initialized on the first student join or authenticated teacher-dashboard load. No seed or manual
migration command is required.

Once participation has begun, the default experiment's config checksum is immutable. Publish a
new experiment ID and version for a new class or changed answer key; do not edit the existing
snapshot in place or delete the production database to restart it. Internal configuration detail
is logged server-side, while public teaching routes return a generic unavailable response.

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
