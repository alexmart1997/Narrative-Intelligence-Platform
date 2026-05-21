# Narrative Intelligence Platform

Narrative Intelligence Platform is a workspace for building tools that collect, analyze, and operationalize narrative signals.

## Repository Layout

- `apps/api` - backend API surface and service entrypoints.
- `apps/web` - user-facing web application.
- `packages/core` - shared domain models, interfaces, and utilities.
- `packages/ingestion` - data collection and normalization workflows.
- `packages/analysis` - narrative analysis, scoring, and interpretation logic.
- `docs` - product notes, architecture decisions, and prompt specs.
- `infra` - deployment, infrastructure, and environment configuration.
- `scripts` - developer and automation scripts.
- `tests` - cross-package integration and regression tests.
- `data` - local development data only; raw and processed payloads are ignored by git.

## Getting Started

Project tooling will be added as the implementation stack is selected.

For now, use this repository as the shared base for iterative prompts, implementation, review, and commits.
