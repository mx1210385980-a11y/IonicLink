# Production deployment

IonicLink deploys automatically after a verified commit is merged into `main`.
Pull requests run the same verification job but never receive production
credentials and never deploy.

## Production layout

| Path | Purpose |
| --- | --- |
| `/opt/ioniclink-source` | Clean Git checkout used only for Docker builds |
| `/opt/ioniclink-v2/.env.production` | Production environment variables |
| `/opt/ioniclink-v2/data` | Persistent SQLite databases, sources, and caches |
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

## GitHub environment secrets

The `production` environment is restricted to the `main` branch and contains:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

Never commit the deployment private key or `.env.production`.

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
