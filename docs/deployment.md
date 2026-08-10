# Production deployment

IonicLink deploys automatically after a verified commit is merged into `main`.
Pull requests run the same verification job but never receive production
credentials and never deploy.

## Production layout

| Path | Purpose |
| --- | --- |
| `/opt/ioniclink-source` | Clean Git checkout used only for Docker builds |
| `/opt/ioniclink-v2/.env.production` | Production environment variables |
| `/opt/ioniclink-v2/data` | Persistent SQLite databases (including `teaching.db`), sources, and caches |
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
`ioniclink-frontend` container, checks `http://127.0.0.1/`, and rolls back to
the previously deployed commit when the new container fails its health check.
The backup helper includes every top-level `*.db`, so the pseudonymous classroom submissions in
`teaching.db` are covered by the same pre-deployment backup and SQLite integrity check.

## GitHub environment secrets

The `production` environment is restricted to the `main` branch and contains:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

Never commit the deployment private key or `.env.production`.

## Application runtime environment

The server-owned `/opt/ioniclink-v2/.env.production` must define a long, unique
`TEACHING_TEACHER_PASSWORD` before a teacher can open the results dashboard. Students do not use
this password and need only a pseudonymous ID. The teaching experiment uses versioned, frozen AI
suggestions, so it does not require a live OpenAI or Anthropic key; those keys remain optional for
the separate live extraction workflow.

The deploy entrypoint exports the host data directory and mounts it at `/app/data`. Do not put a
host-only path inside the container environment. The teaching store therefore persists as
`/opt/ioniclink-v2/data/teaching.db` on the host and `/app/data/teaching.db` in the container.
Teaching schema migrations run automatically, and the default experiment is initialized on the
first student join or authenticated teacher-dashboard load. No seed or manual migration command
is required for teaching.

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
