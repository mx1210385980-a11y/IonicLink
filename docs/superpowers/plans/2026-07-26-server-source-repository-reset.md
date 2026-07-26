# IonicLink Server Source Repository Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `mx1210385980-a11y/IonicLink` with a new one-commit history built from the source currently serving ports 80/8080 on `47.82.82.215`.

**Architecture:** Read `/opt/ioniclink-v2` through SSH into a clean staging directory while excluding secrets, runtime data, research papers, caches, and build artifacts. Preserve the old remote only as a local Git bundle, validate the staged Next.js application, then use a lease-protected force push to replace `main` and explicitly remove the three old development branches.

**Tech Stack:** SSH, rsync, Git/GitHub over SSH, Node.js, npm, Next.js 14, Docker read-only status checks

---

## File map

- Source of truth: `/opt/ioniclink-v2/` on SSH host `ioniclink`
- Staging root: `/Users/julyanffzz/项目/IonicLink-reset-20260726/`
- Local recovery bundle: `/Users/julyanffzz/项目/IonicLink-reset-20260726/backup/IonicLink-before-reset-20260726.bundle`
- Staged repository: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source/`
- Final clean development clone: `/Users/julyanffzz/项目/IonicLink-development/`
- Target remote: `git@github.com:mx1210385980-a11y/IonicLink.git`
- Migration design record: `docs/superpowers/specs/2026-07-26-server-source-repository-reset-design.md`
- Migration plan record: `docs/superpowers/plans/2026-07-26-server-source-repository-reset.md`

### Task 1: Prepare an offline recovery bundle

- [ ] **Step 1: Verify that the operation directories do not already exist**

Run:

```bash
test ! -e '/Users/julyanffzz/项目/IonicLink-reset-20260726'
test ! -e '/Users/julyanffzz/项目/IonicLink-development'
```

Expected: both commands exit successfully with no output. If either path exists, stop instead of overwriting it.

- [ ] **Step 2: Create the staging and backup directories**

Run:

```bash
mkdir -p '/Users/julyanffzz/项目/IonicLink-reset-20260726/backup'
mkdir -p '/Users/julyanffzz/项目/IonicLink-reset-20260726/source'
```

Expected: both directories exist and are empty.

- [ ] **Step 3: Refresh the existing local repository's remote references**

Run:

```bash
git -C '/Users/julyanffzz/项目/Ioniclink' fetch origin --prune
```

Expected: the existing dirty worktree remains untouched, while its remote-tracking `main` is
`cecb54c306755b5b8f89cb2df45885e1a9a394af` and the three old development branches are current.

- [ ] **Step 4: Create and verify a portable Git bundle**

Run:

```bash
git -C '/Users/julyanffzz/项目/Ioniclink' \
  bundle create \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/backup/IonicLink-before-reset-20260726.bundle' \
  refs/remotes/origin/main \
  refs/remotes/origin/claude/crazy-wilson-2d07ef \
  refs/remotes/origin/codex/a-platform-extraction-engine \
  refs/remotes/origin/codex/md

git -C '/Users/julyanffzz/项目/Ioniclink' \
  bundle verify \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/backup/IonicLink-before-reset-20260726.bundle'
```

Expected: verification reports that the bundle is complete and records all four old branch tips.

### Task 2: Stage the running server source

- [ ] **Step 1: Reconfirm the running container and source directory**

Run:

```bash
ssh -o BatchMode=yes ioniclink \
  'docker inspect --format "{{.Name}}|{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}|{{index .Config.Labels \"com.docker.compose.project.config_files\"}}" ioniclink-frontend'
```

Expected:

```text
/ioniclink-frontend|/opt/ioniclink-v2|/opt/ioniclink-v2/docker-compose.prod.yml
```

- [ ] **Step 2: Copy source code with explicit exclusions**

Run:

```bash
rsync -a \
  --include='.env.local.example' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.git/' \
  --exclude='.DS_Store' \
  --exclude='.cache/' \
  --exclude='.claude/' \
  --exclude='.codex-run/' \
  --exclude='.deploy-backups/' \
  --exclude='.next*/' \
  --exclude='.pytest_cache/' \
  --exclude='.superpowers/' \
  --exclude='node_modules/' \
  --exclude='Lubrication_sources/' \
  --exclude='reports/' \
  --exclude='outputs/' \
  --exclude='tmp/' \
  --exclude='*.db' \
  --exclude='*.db-*' \
  --exclude='*.sqlite' \
  --exclude='*.sqlite3' \
  --exclude='*.log' \
  --exclude='*.pid' \
  --exclude='*.pdf' \
  --exclude='*.docx' \
  --exclude='data/sources/' \
  --exclude='data/*/sources/' \
  ioniclink:/opt/ioniclink-v2/ \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/'
```

Expected: application source, lockfile, Docker configuration, tests, scripts, and reproducible small fixtures are copied; the excluded runtime material is not copied.

- [ ] **Step 3: Add the approved migration records**

Run:

```bash
mkdir -p '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/docs/superpowers/specs'
mkdir -p '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/docs/superpowers/plans'

cp \
  '/Users/julyanffzz/项目/Ioniclink-v2/docs/superpowers/specs/2026-07-26-server-source-repository-reset-design.md' \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/docs/superpowers/specs/'

cp \
  '/Users/julyanffzz/项目/Ioniclink-v2/docs/superpowers/plans/2026-07-26-server-source-repository-reset.md' \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/docs/superpowers/plans/'
```

Expected: both approved records are part of the new repository.

### Task 3: Audit the staged source

- [ ] **Step 1: Confirm that no forbidden file classes remain**

Run:

```bash
find '/Users/julyanffzz/项目/IonicLink-reset-20260726/source' \
  -type f \
  \( -name '.env' -o -name '.env.production' -o -name '*.db' -o -name '*.db-*' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.pdf' -o -name '*.docx' -o -name '*.log' -o -name '*.pid' \) \
  -print
```

Expected: no output.

- [ ] **Step 2: Confirm that no oversized source file remains**

Run:

```bash
find '/Users/julyanffzz/项目/IonicLink-reset-20260726/source' \
  -type f -size +25M -print
```

Expected: no output.

- [ ] **Step 3: Scan for common committed-secret signatures**

Run:

```bash
rg -l --hidden \
  -g '!.git/**' \
  -g '!.env.local.example' \
  '(BEGIN (OPENSSH|RSA|EC) PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})' \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/source'
```

Expected: exit code 1 with no file paths, meaning no signature was found.

- [ ] **Step 4: Review the final top-level contents and size**

Run:

```bash
du -sh '/Users/julyanffzz/项目/IonicLink-reset-20260726/source'
find '/Users/julyanffzz/项目/IonicLink-reset-20260726/source' \
  -maxdepth 1 -mindepth 1 -print | sort
```

Expected: a source-sized tree without environment files, databases, papers, dependency folders, or build directories.

- [ ] **Step 5: Restore the versioned gold fixture omitted from the deployment directory**

The README and live-guard test require
`data/tribology/gold-standard/literature-annotations.json`, but the server deployment
directory does not contain it. Restore the 5.3KB mock-DOI fixture from the matching
local v2 source and verify its known digest:

```bash
mkdir -p '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/data/tribology/gold-standard'
cp \
  '/Users/julyanffzz/项目/Ioniclink-v2/data/tribology/gold-standard/literature-annotations.json' \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/data/tribology/gold-standard/'
shasum -a 256 \
  '/Users/julyanffzz/项目/IonicLink-reset-20260726/source/data/tribology/gold-standard/literature-annotations.json'
```

Expected digest:

```text
8ffbc62a3f3055c290a4772f9daf87291e624df4c78dfcc8b048712ac073f0aa
```

Run the previously failing test:

```bash
npx tsx lib/tribologyGoldEvaluationLiveGuard.test.ts
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: `Tribology gold live guard tests passed`.

### Task 4: Validate the application

- [ ] **Step 1: Record runtime versions**

Run:

```bash
node --version
npm --version
```

Expected: Node.js and npm versions print successfully.

- [ ] **Step 2: Install exactly the locked dependencies**

Run:

```bash
npm ci
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: installation completes with exit code 0.

- [ ] **Step 3: Run the repository test suite**

Run:

```bash
npm test
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: all standalone tests pass with exit code 0.

- [ ] **Step 4: Run a production build**

Run:

```bash
npm run build
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: Next.js finishes the production build with exit code 0.

- [ ] **Step 5: Record the regenerated directories for the post-init ignore check**

Expected: `node_modules/` and `.next/` exist after validation; Task 5 confirms they
are ignored after initializing the repository.

### Task 5: Create the new one-commit repository

- [ ] **Step 1: Initialize a fresh `main` branch and local identity**

Run:

```bash
git init -b main
git config user.name 'Julyanffzz'
git config user.email 'mx1210385980@gmail.com'
git remote add origin git@github.com:mx1210385980-a11y/IonicLink.git
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: `git status --short --branch` reports `No commits yet on main`.

- [ ] **Step 2: Confirm regenerated directories are ignored**

Run:

```bash
git check-ignore -q node_modules .next
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: exit code 0, confirming regenerated dependencies and build output cannot enter the commit.

- [ ] **Step 3: Stage all allowed source files**

Run:

```bash
git add --all
git add -f \
  docs/superpowers/specs/2026-07-26-server-source-repository-reset-design.md \
  docs/superpowers/plans/2026-07-26-server-source-repository-reset.md
git diff --cached --check
git status --short
```

Expected: the whitespace check passes and the status contains only source, configuration, tests, small reproducible fixtures, and the two migration records.

- [ ] **Step 4: Verify forbidden paths are not tracked**

Run:

```bash
git ls-files \
  | rg '(^|/)(\.env($|\.)|node_modules|\.next[^/]*|Lubrication_sources|reports|outputs|tmp|\.codex-run|\.deploy-backups)(/|$)|\.(db|sqlite|sqlite3|pdf|docx|log|pid)(-|$|\.)' \
  | rg -v '^\.env\.local\.example$'
```

Expected: exit code 1 with no output.

- [ ] **Step 5: Commit the new root**

Run:

```bash
git commit -m 'Initial commit: import current IonicLink server source'
git rev-list --count HEAD
git log --oneline --decorate -1
```

Expected: the commit succeeds, the commit count is exactly `1`, and `HEAD` is on `main`.

### Task 6: Replace the GitHub history

- [ ] **Step 1: Recheck the remote immediately before destructive writes**

Run:

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

Working directory: `/Users/julyanffzz/项目/IonicLink-reset-20260726/source`

Expected: remote `main` is still `cecb54c306755b5b8f89cb2df45885e1a9a394af`, the same three old development branches still exist, and no tags exist. If any result differs, stop.

- [ ] **Step 2: Lease-protected force push the new root commit**

Run:

```bash
git push origin main:main \
  --force-with-lease=refs/heads/main:cecb54c306755b5b8f89cb2df45885e1a9a394af
```

Expected: GitHub accepts the forced update only if old `main` has not changed.

- [ ] **Step 3: Delete the three explicitly verified old branches**

Run:

```bash
git push origin --delete \
  claude/crazy-wilson-2d07ef \
  codex/a-platform-extraction-engine \
  codex/md
```

Expected: all three branches are deleted successfully.

- [ ] **Step 4: Verify the rewritten remote**

Run:

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

Expected: only `refs/heads/main` exists and points to the new one-commit repository; no tags exist.

### Task 7: Create and verify the clean development clone

- [ ] **Step 1: Clone the rewritten repository**

Run:

```bash
git clone \
  git@github.com:mx1210385980-a11y/IonicLink.git \
  '/Users/julyanffzz/项目/IonicLink-development'
```

Expected: cloning completes without warnings.

- [ ] **Step 2: Configure identity and verify clean history**

Run:

```bash
git config user.name 'Julyanffzz'
git config user.email 'mx1210385980@gmail.com'
git status --short --branch
git rev-list --count HEAD
git branch -a
```

Working directory: `/Users/julyanffzz/项目/IonicLink-development`

Expected: the worktree is clean, the commit count is `1`, and only `main` plus `origin/main` exist.

- [ ] **Step 3: Confirm the production containers remained running**

Run:

```bash
ssh -o BatchMode=yes ioniclink \
  'docker ps --filter name=ioniclink --format "{{.Names}}|{{.Status}}|{{.Ports}}"'
```

Expected: `ioniclink-frontend`, `ioniclink-backend`, and `ioniclink-conductivity` remain up.
