# Candidate Promotion Database Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make extraction results flow through review candidates first, then publish approved candidates into the formal database for both tribology and diffusion.

**Architecture:** Keep extraction persistence as candidate-first. Move candidate-to-record promotion into a backend service and make the frontend choose the correct publish endpoint by extractor type.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, pytest, Vue 3, Vitest.

---

### Task 1: Frontend Publish Dispatch

**Files:**
- Create: `frontend/src/lib/extractionPublish.ts`
- Create: `frontend/src/lib/extractionPublish.test.ts`
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: Write failing Vitest tests**

Add tests that expect tribology rows to use `approveReviewCandidate`, diffusion rows to use `approveDiffusionReviewCandidate`, and non-candidate rows to be ignored.

- [ ] **Step 2: Run the targeted test**

Run: `cd frontend && npm run test -- src/lib/extractionPublish.test.ts --run`

Expected: FAIL because `extractionPublish.ts` does not exist yet.

- [ ] **Step 3: Implement the helper and wire App.vue**

Implement `resolveCandidatePublishTarget(row, fallbackExtractorType)` and use it in `publishReadyPdfUploadRecords()`.

- [ ] **Step 4: Re-run the targeted test**

Run: `cd frontend && npm run test -- src/lib/extractionPublish.test.ts --run`

Expected: PASS.

### Task 2: Backend Candidate Promotion Service

**Files:**
- Create: `backend/services/candidate_promotion_service.py`
- Create: `backend/test_candidate_promotion_service.py`
- Modify: `backend/routers/extraction.py`

- [ ] **Step 1: Write failing pytest tests**

Add tests for tribology and diffusion candidate promotion. Each test creates a candidate, calls the service, and asserts a final record exists with `promoted_record_id` set.

- [ ] **Step 2: Run the targeted test**

Run: `cd backend && pytest test_candidate_promotion_service.py -q`

Expected: FAIL because the service does not exist yet.

- [ ] **Step 3: Implement the service and route integration**

Move copy/promotion behavior into reusable service functions and have review approval endpoints call those functions.

- [ ] **Step 4: Re-run backend tests**

Run: `cd backend && pytest test_candidate_promotion_service.py test_extraction_core.py -q`

Expected: PASS.

### Task 3: Verification And Remote Sync

**Files:**
- No additional source files.

- [ ] **Step 1: Run focused frontend and backend verification**

Run:
`cd frontend && npm run test -- src/lib/extractionPublish.test.ts --run`
`cd backend && pytest test_candidate_promotion_service.py test_extraction_core.py -q`

- [ ] **Step 2: Sync to remote server**

Run:
`IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all`

- [ ] **Step 3: Report changed files and verification output**

Summarize the implemented bridge, the commands run, and the deploy result.
