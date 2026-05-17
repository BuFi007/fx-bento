# FX Unified Backend Scaffold Notes

## Architecture Notes

This branch reshapes the repo toward a Next Forge-compatible workspace layout while preserving the existing Foundry contract surface. The backend is a Bun + Hono API in `apps/api`, with product logic split into focused `packages/*` modules and Ponder isolated under `apps/ponder`.

Core boundaries:

- Liveblocks makes room/workflow state realtime, but is never trusted for balances, orders, escrow, liquidation, settlement, or prizes.
- Ponder is the indexed read layer for onchain events.
- x402 gates paid API and AI workflow execution before handlers run.
- MCP exposes workflows as agent-operable tools, but financial tools remain blocked on payment and wallet signature requirements.
- Contracts settle money. The backend coordinates UX, quotes, validation, and indexing reconciliation.

## What Exists Already

- Package manager: Bun, with an existing `bun.lock`.
- Scripts: Foundry contract build/test, backend dev, and root TypeScript typecheck.
- Contracts: FX Bento room, escrow, commitment, scoring, settlement, pool registry, fee vault, and mocks under `src/`.
- SDK: viem helpers for pool ids, commitment hashes, and anti-wall validation under `sdk/src`.
- Frontend scaffold: FX Bento Arcade components under `frontend/src/components`.
- Backend before this branch: a single `backend/src/server.ts` Hono file with in-memory arcade rooms and a permissive Liveblocks auth endpoint.

## Sendero Patterns Reused

- Liveblocks: adapted `packages/collaboration` room naming, server-side `prepareSession`, allowlisted room auth, and typed presence/storage concepts.
- Ponder: adapted `apps/ponder` config/schema/handler split, stable event ids from transaction hash + log index, and append-only event rows.
- x402: adapted Sendero edge middleware flow: missing payment returns 402 with advertised requirements, payment payloads are matched against server requirements, and receipts are recorded.
- Route organization: product route modules are mounted into one Hono app, following Sendero edge route composition.
- Env: typed zod env parsing with optional production secrets and explicit missing runtime checks.

## Gaps

- The repo was not yet a full Next Forge/Turborepo workspace; this branch adds workspaces and `turbo.json`.
- No existing wallet/session auth package existed in this repo; this branch adds signed-message helpers without Clerk.
- No existing logger package existed locally; this branch wraps and directly uses `@bufinance/logger`.
- No existing Bufinance worker middleware was used; this branch uses `@bufinance/worker-base`.
- Ponder ABIs are still placeholder/minimal until generated contract ABIs are exported.
- x402 verification is provider-abstraction-ready, with a dev verifier scaffold until a production facilitator is wired.

## New Packages And Routes

Packages:

- `packages/auth`: wallet session headers, signed action verification, nonce enforcement.
- `packages/env`: typed runtime env.
- `packages/logger`: app logger helpers over `@bufinance/logger`.
- `packages/liveblocks`: room helpers and server auth.
- `packages/ponder`: indexed state helpers.
- `packages/x402`: payment requirements, middleware, verifier abstraction, receipts.
- `packages/mcp`: tool registry and workflow state machine.
- `packages/market-data`, `packages/perps`, `packages/fx-telarana`, `packages/fx-bento`: domain services and zod schemas.
- `packages/contracts`, `packages/db`, `packages/shared-types`, `packages/ui`: shared contract metadata, in-memory scaffold store, types, and UI entry components.

API routes:

- `/health`
- `/liveblocks/auth`
- `/markets`, `/markets/:marketId`, `/markets/:marketId/price`, `/markets/:marketId/candles`
- `/perps/markets`, `/perps/quote`, `/perps/intents`, `/perps/intents/:id`, `/perps/positions/:address`, `/perps/trades/:address`, `/perps/funding`, `/perps/liquidations/candidates`
- `/fx-bento/rooms`, `/fx-bento/rooms/:id`, `/fx-bento/rooms/:id/join`, `/fx-bento/rooms/:id/commit`, `/fx-bento/rooms/:id/reveal`, `/fx-bento/rooms/:id/leaderboard`, `/fx-bento/rooms/:id/settle`
- `/fx-telarana/markets`, `/fx-telarana/borrow/quote`, `/fx-telarana/borrow/intents`, `/fx-telarana/positions/:address`
- `/mcp/tools`, `/mcp/workflows`, `/mcp/workflows/:id`, `/mcp/workflows/:id/run`
- `/x402/receipts`, `/x402/verify`
