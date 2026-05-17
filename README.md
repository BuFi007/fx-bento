# FX² Arcade Protocol

> **Status:** validation scaffold. Do not deploy paid public rooms from this branch until the P0 contract tasks in `TODOS.md` are complete and the invariant suite passes.

FX² Arcade Protocol is a decentralized multiplayer arcade layer for FX markets. FX Bento is the first game: players enter USDC rooms, compete on future price-tile predictions using equal chip budgets, and win from capped player-funded prize pools. Uniswap v4 hooks anchor the game to real market pools, while escrow contracts guarantee that no player or admin can withdraw room funds outside the rules. The protocol earns transparent rake and never takes uncapped directional risk.

## Architecture

- `FXBentoHook.sol`: canonical v4-core `IHooks` market snapshot hook. It caches allowed pools after initialization, records indexed PoolManager snapshots, emits market events, and never custodies player escrow.
- `FXBentoRoomFactory.sol`: creates immutable FX Bento room configs.
- `FXBentoRoomEscrow.sol`: holds entry fees, refunds cancelled rooms, stores typed payout-root metadata, settles Merkle prize roots, enforces `payouts + rake <= escrow`.
- `FXBentoRoundManager.sol`: stores round timing, fresh anchor snapshot ids, and settlement snapshot ids.
- `FXBentoCommitmentManager.sol`: commit-reveal tile selections with optional EIP-712-style batched commitments.
- `FXBentoScoring.sol`: pure anti-wall validation and fixed-point hit scoring.
- `FXBentoSettlementManager.sol`: MVP attestor/challenge/finalize flow with typed payout payload validation and timeout rescue.
- `PoolRegistry.sol`: allowed FX pool registry.
- `ProtocolFeeVault.sol`: receives protocol rake.

Settlement evidence and challenge requirements live in `docs/settlement-evidence-policy.md`.

## Product Surface

Frontend mode: **FX Bento Arcade**

Lobby copy:

- “FX² Arcade Protocol”
- “Play FX Bento”
- “Join kawaii FX prediction rooms. Same chips. Same market. Highest score wins.”

Backend endpoints:

- `GET /health`
- `GET /fx-bento/rooms`
- `POST /fx-bento/rooms`
- `POST /fx-bento/rooms/prepare`
- `GET /fx-bento/rooms/:id`
- `GET /fx-bento/rooms/:id/players`
- `GET /fx-bento/rooms/:id/rounds`
- `POST /fx-bento/rooms/:id/join`
- `POST /fx-bento/rooms/:id/leave`
- `POST /fx-bento/rooms/:id/commit`
- `POST /fx-bento/rooms/:id/reveal`
- `GET /fx-bento/rooms/:id/leaderboard`
- `GET /fx-bento/rooms/:id/claims/:address`
- `POST /fx-bento/rooms/:id/claim`
- `POST /fx-bento/rooms/:id/settle`
- `GET /fx-bento/markets/:poolId/snapshots`

Canonical write routes return contract transaction requests. Local simulator mutation routes live under `/fx-bento/dev/*` and are disabled outside development/test.

## Commands

```bash
git submodule update --init --recursive
bun install
forge fmt --check
forge build
forge test
bun run test:ts
bun run typecheck
bun run verify
forge script script/PlanFXBentoDeployment.s.sol --sig "run()"
bun run backend:dev
bun run test:anvil
bun run dev:worker
bun run --cwd apps/ponder codegen
```

Useful backend env:

- `PONDER_GRAPHQL_URL`: remote Ponder GraphQL endpoint used by the API for indexed room reads.
- `PONDER_SQL_URL`: Postgres-compatible Ponder SQL database URL; used as the production persistence backend when `FX_BENTO_DATABASE_URL` is not set.
- `CONTRACT_RPC_URL`: RPC endpoint used for viem `simulateContract` and contract-read reconciliation.
- `CONTRACT_ADDRESSES_JSON`: chain-scoped contract address map consumed by API transaction prep and reconciliation.
- `FX_BENTO_DATABASE_URL`: Postgres database URL for worker jobs, settlement proofs, and x402 receipts.
- `FX_BENTO_DB_PATH`: SQLite DB path for worker jobs, tx confirmation status, settlement allocations, and claim proofs; defaults to `.fx-bento/fx-bento-<env>.sqlite`.
- `WORKER_JOB_STORE_PATH`: legacy fallback path for worker jobs, now interpreted as a SQLite DB path.
- `SETTLEMENT_RESULT_STORE_PATH`: legacy fallback path for settlement allocations/proofs, now interpreted as a SQLite DB path.
- `WORKER_STUCK_JOB_SECONDS`: age threshold for surfacing stuck finalizations in worker health; defaults to `600`.
- `OPERATOR_ALERT_WEBHOOK_URL`: optional production alert sink; worker health, drain, and dashboard requests post `operator.alerts` here when alerts are present.
- `OPERATOR_ALERT_MIN_SEVERITY`: `warning` or `critical`; defaults to `warning`.
- `OPERATOR_ALERT_DEDUP_SECONDS`: in-process alert dedupe window; defaults to `900`.

## Status

This is an MVP scaffold with passing Foundry coverage for room creation, joins, max-player limits, min-player lock checks, clean cancellation/refund failure paths, paid active membership, commit-reveal, anti-wall rejection, scoring, hook snapshots, round anchoring, typed settlement payloads, challenge resolution, timeout rescue refunds, rake, prize claims, double-settlement prevention, and lifecycle accounting invariants.

The backend worker persists lifecycle jobs, settlement proofs, and x402 receipts through Postgres/Ponder SQL in production or SQLite locally, retries delayed submissions/confirmations with backoff, and exposes/pages operator health for pending confirmations, Ponder lag, and stuck finalizations.

Current hardening references:

- `AGENTS.md`: agent and architecture guidance.
- `docs/architecture-reference.md`: full validation-first architecture plan.
- `docs/hook-deployment.md`: v4 permission-bit and deployment notes.
- `docs/p0-validation-qa.md`: room-first QA matrix across contracts, SDK assumptions, and user-visible failure paths.
- `docs/p1-backend-sdk.md`: contract-aligned backend coordinator and SDK transaction helper notes.
- `docs/threat-model.md`: current trust boundaries and limitations.
- `TODOS.md`: P0/P1 implementation queue.
- `.env.example`: local backend, Liveblocks, and deployed contract address slots for the viem poller.
- `/Users/criptopoeta/.gstack/projects/BuFi007-fx-bento/main-autoplan-test-plan-20260516-205300.md`: expanded validation and invariant test plan.
