# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Structure

This repository contains a monorepo setup with a `frontend` (Vue 3, TypeScript, Vite) and a `backend` (FastAPI, Python) application.

- **`frontend/`**: The client-side application built with Vue 3, TypeScript, and Vite.
- **`backend/`**: The server-side API built with FastAPI and Python.

## High-Level Architecture

### Frontend
The frontend is a Single Page Application (SPA) using Vue 3 with the Composition API and `<script setup>` SFCs.
- **Framework**: Vue 3
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Component Structure**: `src/App.vue` serves as the main entry point, with UI components located in `src/components/`.
- **API Communication**: Uses `axios` for making HTTP requests to the backend, with `src/lib/api.ts` likely handling API service definitions.
- **Data Visualization**: Integrates `chart.js` and `vue-chartjs`.
- **PDF Handling**: `pdfjs-dist` is used for PDF rendering/processing.

### Backend
The backend is a FastAPI application providing RESTful APIs.
- **Framework**: FastAPI
- **Language**: Python
- **Asynchronous Server**: `uvicorn`
- **Database**: Uses `sqlalchemy` and `aiosqlite`, suggesting an SQLite database (likely `ioniclink.db` as per modified file list).
- **API Endpoints**: Organized into routers, including `extraction`, `sync_router`, and `data_explorer`.
- **LLM Integration**: Integrates `openai` and `google-generativeai` via `llm_service.py` for Language Model interactions.
- **File Services**: `file_service.py` handles file-related operations, and `pymupdf` and `pillow` are used for PDF and image processing.
- **Configuration**: Uses `python-dotenv` for environment variable management.

## Common Development Tasks

## Remote Synchronization

All local code changes for this repository should be synchronized to the remote server after verification.

- **Server**: `root@47.82.82.215`
- **SSH alias/key**: use the local `ioniclink` SSH host alias, which points to `~/.ssh/ioniclink_deploy`.
- **Remote directory**: `/opt/ioniclink/repo`
- **Deploy command**:
  ```bash
  IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
  ```
- The deployment script intentionally excludes runtime data such as dependency folders, backend data, and temporary uploads.

### Frontend

- **Install Dependencies**:
  ```bash
  cd frontend
  npm install
  ```
- **Run Development Server**:
  ```bash
  cd frontend
  npm run dev
  ```
- **Build for Production**:
  ```bash
  cd frontend
  npm run build
  ```
- **Preview Production Build**:
  ```bash
  cd frontend
  npm run preview
  ```

### Backend

- **Install Dependencies**:
  ```bash
  cd backend
  pip install -r requirements.txt
  ```
- **Run Development Server**:
  ```bash
  cd backend
  uvicorn main:app --reload
  ```

## Testing and Linting

- No explicit test scripts or configurations were found in `package.json` or by searching common file patterns for either frontend or backend.
- Frontend uses `vue-tsc` for TypeScript type checking during the build process.
- No explicit linting configurations (e.g., ESLint, Pylint) were found.

If you are developing, it's recommended to run the frontend and backend development servers concurrently.
