# Repository Guidelines

## Project Structure & Module Organization
The repo hosts three active applications. `frontend/` is the Vite-based React UI; keep feature modules under `src/components`, shared helpers in `src/lib`, and static assets in `src/assets`. `frontend-next/` contains the Next.js migration with route-level folders beneath `app/` (e.g., `app/upload`). The serverless API lives in `menu-combo-backend/`, with Lambda handlers in `handler.js`, domain services inside `services/`, middleware definitions in `middleware/`, and SQL artifacts under `db/`. Docs and prototypes belong in `docs/`; avoid committing build output (`dist/`, `.next/`) and generated assets.

## Build, Test, and Development Commands
Install dependencies per package: `cd frontend && npm install`, `cd frontend-next && npm install`, `cd menu-combo-backend && npm install`. Run the Vite client via `npm run dev` and build it with `npm run build`; use `npm run lint` before opening a PR. The Next.js app uses `npm run dev`, `npm run build`, and `npm run start` for production smoke tests. For the backend, start local Lambdas with `npx serverless offline --stage dev` and deploy using `npx serverless deploy` once changes are reviewed.

## Coding Style & Naming Conventions
We target modern TypeScript (ES2022 modules). Prefer functional React components, PascalCase filenames for components (`UploadForm.tsx`), camelCase utilities, and kebab-case directories. Tailwind v4 powers styling; colocate utility classes with JSX and keep extracted patterns in `frontend/src/components`. ESLint flat configs are enforced; run `npm run lint` and fix warnings before pushing. Keep handler logic small, delegating to service modules in the backend.

## Testing Guidelines
There is no shared automated test harness yet. When contributing, add targeted checks where possible (e.g., introduce Vitest suites under `frontend/src/__tests__` or request backend integration tests using `node:test`). At minimum, describe manual validation steps in your PR and ensure linting passes. For backend changes, log sample invocations using `serverless offline` and document payloads you exercised.

## Commit & Pull Request Guidelines
Follow Conventional Commit prefixes observed in history (`feat:`, `fix:`, `chore:`). Keep commits scoped to a logical change set and include config or schema updates alongside their code. Each PR should summarize intent, list test evidence, link tracking issues when available, and attach UI screenshots or curl transcripts for user-facing work. Request at least one reviewer per domain (frontend or backend) and wait for green checks before merging.

## Environment & Secrets
Store environment variables in untracked files: `frontend/.env` for Vite, `frontend-next/.env.local` for Next.js, and `menu-combo-backend/.env` for AWS credentials. Provide copy-ready `.env.example` files when adding new settings and never commit live keys. Coordinate rotations with the backend owner if secrets change.
