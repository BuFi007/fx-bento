<!-- /autoplan restore point: /Users/criptopoeta/.gstack/projects/BuFi007-fx-bento/feature-next-forge-fx-arcade-backend-autoplan-restore-20260516-211504.md -->
# FX Bento Backend Engine Autoplan

Base branch: `main`  
Work branch: `feature/next-forge-fx-arcade-backend`  
Scope: turn the current Hono/Next Forge scaffold into a contract-backed backend engine for FX Bento.

## Core Rule

The backend coordinates. It does not become the source of truth for money.

- `FXBentoHook` anchors market context and emits snapshots.
- `FXBentoRoomEscrow` holds entry funds, refunds, prize claims, and protocol rake.
- `FXBentoSettlementManager` owns result submission, challenge, and finalization.
- `FXBentoCommitmentManager` owns commit/reveal integrity.
- Ponder indexes contract state.
- Liveblocks projects realtime UX state only.
- Hono APIs prepare, validate, simulate, and expose workflows.
- Worker jobs schedule safe contract actions and reconcile indexed state.

## What Exists Now

- Solidity contracts cover factory, escrow, rounds, commitments, scoring, settlement, pool registry, hook snapshots, and fee vault.
- Contract tests cover room creation, joins, max-player limits, cancellation refunds, commits/reveals, anti-wall scoring, settlement, rake, prize claims, and payout invariants.
- Backend scaffold exists under `apps/api`, `apps/ponder`, and `packages/*`.
- `@bufinance/logger` is wrapped by `packages/logger`.
- API app uses Hono and `@bufinance/worker-base`.
- Liveblocks helpers exist for room naming, authorization, metadata, and permissions.
- x402, MCP, market data, and FX Bento domain packages are scaffolded.

## Main Gaps

1. `packages/fx-bento` is still an in-memory room simulator. It needs a contract-backed room engine.
2. `apps/ponder` currently maps only `FXBentoRoomEscrow:RoomJoined`.
3. The current Ponder `RoomJoined` mapper assumes an `amount` arg that the event does not emit.
4. `packages/contracts` event constants do not match current Solidity names:
   - `RefundClaimed` should be `Refunded`.
   - `ResultsRootPosted` should be `ResultsSubmitted`.
   - `CommitmentSubmitted` should be `SelectionCommitted`.
5. No ABI/type generation layer exists for viem reads, simulations, and transaction requests.
6. No persistent DB-backed room, round, commitment, reveal, claim, or job model exists yet.
7. No worker scheduler exists for round starts, anchor recording, settlement recording, result publication, and finalization.
8. API endpoints return scaffold state instead of Ponder state plus contract read reconciliation.
9. Settlement root generation, Merkle allocation storage, and claim proof APIs are missing.
10. Liveblocks does not yet receive indexed room/round/player projections from Ponder.

## Latest Progress

- Added `bun run test:anvil`, which starts local Anvil, deploys FX Bento contracts, seeds `CONTRACT_RPC_URL` and `CONTRACT_ADDRESSES_JSON`, and exercises API transaction prep for create, join, commit, reveal, submit results, finalize, and claim.
- The lifecycle harness runs viem `simulateContract` against the deployed contracts before calldata is accepted, then replays receipts through the Ponder read-model helpers and asserts API reads match settled contract state.
- `finalize_results` worker confirmation persistence now records the finalization tx hash and `confirmed` status in the durable SQLite job store.
- `finalize_results` now supports worker-owned submission, receipt polling, durable finalization status, and settlement allocation/proof persistence. API claim reads can serve stored Merkle proofs once the worker confirms finalization.
- Production retry/backoff and indexed confirmation polling are now wired: delayed submissions/receipts stay pending with `nextAttemptAt`, and remote Ponder lag keeps confirmations open until finalized state is indexed.
- The persistence adapter now supports Postgres/Ponder SQL for production and SQLite for local/dev. Worker jobs, settlement proofs, and x402 receipts share that adapter.
- Worker health and operator endpoints now surface pending confirmations, delayed receipts, Ponder lag, failed jobs, and stuck `finalize_results` jobs.

## Contract To Backend Map

| Contract | Events to index | Backend responsibility | Critical reads |
| --- | --- | --- | --- |
| `FXBentoRoomFactory` | `RoomCreated`, `RoomStatusUpdated`, `EntryTokenAllowed`, `LimitsUpdated`, `EscrowUpdated` | Build room registry, immutable config cache, status transitions | `getRoom`, `getPayoutBps`, `nextRoomId`, `allowedEntryToken` |
| `FXBentoRoomEscrow` | `RoomJoined`, `RoomLeft`, `RoomCancelled`, `RoomLocked`, `RoomSettled`, `Refunded`, `PrizeClaimed`, `ProtocolFeeClaimed` | Player roster, escrow state, refund/claim status, payout accounting | `players`, `joined`, `refunded`, `prizeClaimed`, `resultsRoot`, `escrowed`, `protocolFee` |
| `FXBentoRoundManager` | `RoundStarted`, `AnchorRecorded`, `SettlementRecorded` | Round clock, lock windows, anchor and settlement price timeline | `getRound` |
| `FXBentoCommitmentManager` | `SelectionCommitted`, `SelectionRevealed` | Commit/reveal status, gasless commitment audit, reveal availability | `commitments`, `revealedSelectionHash`, `hashSelection` |
| `FXBentoSettlementManager` | `ResultsSubmitted`, `ResultsChallenged`, `ResultsFinalized` | Result publication, challenge window tracking, finalization jobs | `pendingResults`, `challengeWindow` |
| `FXBentoHook` | `PoolInitialized`, `FXBentoMarketSnapshot`, `PreSwapContext`, `ArcadeFeeVaultUpdated` | Market snapshots, volatility context, oracle freshness checks | `latestSnapshot`, `getPoolSnapshot`, `realizedVolatility` |
| `PoolRegistry` | `PoolAllowed` | Allowed market registry and freshness policy | `getPool`, `isAllowed` |
| `ProtocolFeeVault` | `TreasuryUpdated`, `FeeReceived`, `FeeSwept` | Rake receipt accounting and treasury visibility | `treasury` |

## Engine Shape

Keep the existing package boundaries. Do not create a parallel backend stack.

`packages/contracts`
- Export generated ABIs and typed contract names.
- Parse chain-scoped contract addresses from typed env.
- Provide `getFxBentoContracts(chainId)` and `getContractConfig(name)`.
- Keep event names generated or directly tested against ABI fragments.

`packages/ponder`
- Own event normalization and read-model helpers.
- Produce deterministic ids from `chainId:blockNumber:logIndex` or `txHash:logIndex`.
- Treat handlers as idempotent, meaning the same log can be replayed without duplicating state.
- Expose room, round, player, snapshot, commitment, reveal, result, claim, fee, and health views.

`packages/fx-bento`
- Become the pure domain and engine package.
- Keep schema validation, anti-wall checks, scoring helpers, and typed room models.
- Add Merkle result generation and claim proof helpers.
- Add transaction request builders for factory, escrow, commitment, round, and settlement flows.
- Add reconciliation helpers that compare Ponder state with contract reads before critical actions.

`apps/api`
- Keep Hono.
- Return indexed state for read endpoints.
- Return viem transaction requests for write endpoints unless an explicitly authorized backend role performs the action.
- Validate every body/query/path with zod.
- Use `@bufinance/logger` for structured route and workflow logs.
- Use x402 only for paid API/AI/compute gates, never as a substitute for entry escrow.

`apps/worker`
- Add a Bun worker app using `@bufinance/worker-base`.
- Run round scheduling, anchor recording, settlement price recording, result root publication, finalization checks, Liveblocks projection, and reconciliation jobs.
- Make all jobs idempotent and keyed by room/round/action.

`packages/liveblocks`
- Keep auth and room naming helpers.
- Add projection helpers that convert indexed room state into presence/storage patches.
- Never write balances, claims, escrow, or settlement truth into trusted app state.

## Data Model

The persistent model should match contract semantics.

| Table/view | Primary key | Source | Notes |
| --- | --- | --- | --- |
| `fx_bento_rooms` | `chainId, roomId` | Factory events plus `getRoom` | Immutable config, status, pool id, entry token, rake, payout hash |
| `fx_bento_room_players` | `chainId, roomId, player` | Escrow events plus reads | joined, left, refunded, entry tx, refund tx |
| `fx_bento_rounds` | `chainId, roomId, roundIndex` | Round manager events plus reads | start, lock, end, anchor price, settlement price, status |
| `fx_bento_commitments` | `chainId, roomId, roundIndex, player` | Commitment events plus reads | commitment hash, submitted by player or batcher |
| `fx_bento_reveals` | `chainId, roomId, roundIndex, player` | Reveal events | selected tiles hash, reveal tx, pattern status |
| `fx_bento_snapshots` | `chainId, poolId, snapshotIndex` | Hook events | sqrt price, tick, timestamp, volatility |
| `fx_bento_results` | `chainId, roomId` | Settlement events | root, metadata URI, attestation, challenged, finalized |
| `fx_bento_allocations` | `chainId, roomId, player` | Backend result builder | score, rank, amount, Merkle proof, result hash |
| `fx_bento_claims` | `chainId, roomId, player` | Escrow events plus reads | prize claimed amount and tx |
| `fx_bento_fees` | `chainId, roomId` | Escrow/vault events | protocol fee, claimed, swept |
| `fx_bento_jobs` | `chainId, roomId, roundIndex, kind` | Worker | job status, attempts, last error, tx hash |

## API Target

Keep current routes and make them contract-backed.

Read routes:
- `GET /fx-bento/rooms`
- `GET /fx-bento/rooms/:id`
- `GET /fx-bento/rooms/:id/leaderboard`
- `GET /fx-bento/rooms/:id/rounds`
- `GET /fx-bento/rooms/:id/players`
- `GET /fx-bento/rooms/:id/claims/:address`
- `GET /fx-bento/markets/:poolId/snapshots`

Write/prepare routes:
- `POST /fx-bento/rooms` returns a `createRoom` transaction request.
- `POST /fx-bento/rooms/:id/join` returns a `joinRoom` transaction request.
- `POST /fx-bento/rooms/:id/leave` returns a `leaveRoom` transaction request.
- `POST /fx-bento/rooms/:id/commit` returns direct or batched `commitSelection` data.
- `POST /fx-bento/rooms/:id/reveal` validates reveal payload and returns `revealSelection` data.
- `POST /fx-bento/rooms/:id/refund` returns a `refund` transaction request.
- `POST /fx-bento/rooms/:id/claim` returns amount/proof plus `claimPrize` transaction data.
- `POST /fx-bento/rooms/:id/settle` queues an authorized settlement workflow, gated by role and x402 if exposed to agents.

Admin/worker-only routes must require strict role checks:
- lock room
- start round
- record anchor
- record settlement
- submit results
- finalize results
- claim protocol fee

## Workflow State Machines

Room status:

```text
lobby(0)
  -> locked/active(1) by escrow.lockRoom
  -> cancelled(4) by escrow.cancelRoom
locked/active(1)
  -> settling(2) if factory owner/authorized process marks explicit settling
  -> settled(3) by escrow.settleRoom/factory status update
settling(2)
  -> settled(3) by escrow.settleRoom/factory status update
settled(3)
cancelled(4)
```

Round status:

```text
not_created(0)
  -> active(1) by roundManager.startRound
active(1)
  -> settled(2) by roundManager.recordSettlement
```

Settlement workflow:

```text
draft
  -> pending_signature for financial user actions
  -> pending_payment for paid compute or AI execution
  -> running when payment/signature requirements are met
  -> completed when indexed event confirms success
  -> failed with retry metadata
  -> cancelled by explicit user action
```

## Milestones

### M0. Fix Scaffold Mismatches

Goal: make the scaffold describe the actual contracts.

Tasks:
- Correct event name constants in `packages/contracts`.
- Remove the nonexistent `amount` payload from `RoomJoined` mapping.
- Add ABI source or generated ABI exports for every FX Bento contract.
- Add tests that compare exported event names with ABI event names.

Acceptance:
- `bun run typecheck`
- `bun run test:ts`
- `forge fmt --check`
- `forge build`
- `forge test`

### M1. Full Ponder Indexing

Goal: index every contract transition needed for room state.

Tasks:
- Configure Ponder contracts for factory, escrow, round manager, commitment manager, settlement manager, hook, pool registry, and fee vault.
- Add handlers for every event in the contract map.
- Add normalized read-model helpers for room detail, player roster, current round, leaderboard inputs, claim status, and market snapshots.
- Make handlers replay-safe.

Acceptance:
- Unit tests for each event mapper.
- Anvil smoke test that deploys contracts, emits room lifecycle events, runs Ponder, and verifies room view.

### M2. Viem Contract Adapter

Goal: every write endpoint returns safe transaction requests and every critical action can reconcile reads.

Tasks:
- Add public and wallet client builders.
- Add `simulateContract` before returning write requests.
- Add typed builders for `createRoom`, `joinRoom`, `leaveRoom`, `commitSelection`, `commitSelectionFor`, `revealSelection`, `refund`, `claimPrize`, `lockRoom`, `startRound`, `recordAnchor`, `recordSettlement`, `submitResults`, `finalizeResults`, and `claimProtocolFee`.
- Enforce deadline, chain id, nonce, address, and role checks.

Acceptance:
- Unit tests for transaction request builders.
- Signature tests for batched commitments.
- Simulated Anvil transactions for create, join, lock, commit, reveal, settle, claim.

### M3. Contract-Backed API

Goal: replace in-memory game state with indexed state plus contract reconciliation.

Tasks:
- Refactor `packages/fx-bento` into pure schemas, scoring, Merkle, and engine helpers.
- Change `apps/api/src/routes/fx-bento.ts` reads to query Ponder/read-model helpers.
- Change write routes to return transaction requests or queue worker jobs.
- Add domain error mapping for contract simulation failures.
- Add address/chain-aware pagination for room/player/snapshot endpoints.

Acceptance:
- API tests cover happy path, bad chain id, stale room state, invalid player, invalid reveal, and already-claimed prize.
- `/health` includes API, Ponder, contract RPC, Liveblocks, x402, and worker health.

### M4. Worker Engine

Goal: automate only actions the backend is authorized to perform.

Tasks:
- Add `apps/worker` using `@bufinance/worker-base`.
- Add job kinds: `lock_room`, `start_round`, `record_anchor`, `record_settlement`, `build_results`, `submit_results`, `finalize_results`, `project_liveblocks`, `reconcile_room`.
- Add retry policy, backoff, idempotency keys, and structured logs.
- Store job attempts and tx hashes.
- Require configured role/private key only for local/dev or protected worker runtime.

Acceptance:
- Worker unit tests for retry/idempotency.
- Anvil end-to-end job run from room lock through result finalization.

### M5. Result Builder And Claims

Goal: compute deterministic scores and Merkle allocations that match escrow claims.

Tasks:
- Port contract scoring assumptions into TypeScript tests using the same fixtures as Foundry.
- Build result payload with room id, rounds, players, scores, ranks, allocation amounts, protocol fee, and Merkle root.
- Persist result metadata URI or content-addressable payload.
- Add claim proof endpoint.
- Reconcile `totalPrizePayouts + protocolFee <= escrowed` before publishing.

Acceptance:
- Property tests for payout invariants.
- Cross-check TypeScript score outputs against Solidity `FXBentoScoring` fixture outputs.
- Claim proof accepted by `FXBentoRoomEscrow.claimPrize` on Anvil.

### M6. Liveblocks Projection

Goal: make realtime UX reflect indexed contract state without trusting it.

Tasks:
- Project waiting room roster, current round clock, hover/preview presence, and leaderboard preview.
- Clear or mark stale projections when Ponder falls behind.
- Add room metadata updates from room status events.
- Keep balances, claims, escrow, and settlement truth out of trusted Liveblocks state.

Acceptance:
- Tests for room permission generation and projection payloads.
- Manual smoke with two clients observing room lifecycle updates.

### M7. MCP And x402 Production Gates

Goal: agent workflows can inspect and prepare actions safely.

Tasks:
- Expose MCP tools for room inspection, room creation prep, join prep, settlement inspection, claim inspection, oracle freshness, and Ponder state.
- Require wallet signatures for financial actions.
- Require x402 payment for paid compute, premium data, and agent-triggered workflows where configured.
- Persist x402 receipts outside process memory. [done] Usage accounting can build on the same receipt table.

Acceptance:
- MCP workflow tests for payment/signature gates.
- x402 middleware tests for valid, missing, expired, and wrong-resource payments.

### M8. Production Readiness

Goal: operational confidence before public rooms.

Tasks:
- Add rate limits, request ids, structured logs, and route metrics.
- Add RPC circuit breakers and stale-indexer alerts.
- Add role checks for all worker/admin endpoints.
- Add deployment docs and env matrix.
- Add disaster runbook for stuck rooms, challenged results, stale oracle, and delayed Ponder.

Acceptance:
- `bun run typecheck`
- `bun run test:ts`
- `forge fmt --check`
- `forge build`
- `forge test`
- Anvil end-to-end room lifecycle
- Ponder replay test
- API smoke test

## Immediate Next Coding Slice

Implement M0 and the first half of M1.

Files to touch:
- `packages/contracts/src/index.ts`
- `apps/ponder/ponder.config.ts`
- `apps/ponder/ponder.schema.ts`
- `apps/ponder/src/index.ts`
- `packages/ponder/src/index.ts`
- `packages/ponder/src/mapping.test.ts`
- `packages/fx-bento/src/index.ts`
- `apps/api/src/routes/fx-bento.ts`

Expected output:
- Correct contract event vocabulary.
- Ponder handlers for factory, escrow, round, commitment, settlement, hook, registry, and fee events.
- Tests proving handler payloads match Solidity event args.
- API room reads ready to consume indexed room state.

## Security Gates

- No Clerk.
- No SaaS auth boilerplate.
- No client-provided price accepted for settlement.
- No Liveblocks state accepted for balances, escrow, claims, or settlement.
- No backend move-money path without explicit wallet signature or protected role.
- No x402 receipt treated as an escrow payment.
- Every transaction builder simulates before returning calldata.
- Every worker action checks indexed state and critical contract reads.
- Every settlement root checks escrow coverage before submission.
- Every nonce/deadline/signature flow has tests.

## Decision Audit

| Decision | Choice | Reason |
| --- | --- | --- |
| Backend source of truth | Ponder plus contract reads | Ponder gives fast state, contract reads protect critical paths. |
| Package structure | Extend existing packages | Avoid duplicating a second game backend package. |
| Worker runtime | Add `apps/worker` with `@bufinance/worker-base` | Round and settlement automation belongs outside request handlers. |
| API write behavior | Return transaction requests by default | Users sign financial actions; backend does not custody funds. |
| Settlement path | Authorized attestor MVP with challenge window | Matches current contracts and leaves room for stronger proofs later. |
| Liveblocks role | Projection and presence only | Preserves the core trust boundary. |
| x402 role | Paid compute/API/agent gate only | Entry fees and prizes stay contract-native. |

## Open Questions

1. Which chain id and deployed contract addresses should be the first live target?
2. Should `RoomStatusUpdated(status=2)` be used explicitly for settling, or should settlement remain `1 -> 3` until contracts change?
3. Where should result metadata live first: local dev storage, S3/R2, IPFS, or Arweave?
4. Should `commitSelectionFor` batching be enabled in MVP, or ship direct player commits first?
5. What is the first production market pair and oracle freshness policy?

## GSTACK REVIEW REPORT

CEO review:
- The complete product backend is the correct lake to boil. A room lifecycle without indexing, reconciliation, settlement roots, and worker scheduling is not a backend engine.
- The first coding slice should not jump straight to UI polish or agent workflows. Money-state correctness comes first.
- The visible user outcome is simple: a player can create, join, play, settle, and claim from a room while the backend makes the game feel live without becoming the bank.

Design review:
- UX responsiveness should come from Liveblocks projections of indexed state.
- The UI should show pending, indexed, stale, challenged, claimable, and claimed states clearly.
- Do not expose raw backend uncertainty as game truth. Use contract-confirmed labels where money is involved.

Engineering review:
- The highest-risk current bug is the mismatch between Solidity events and TypeScript event constants/mappers.
- The main architecture risk is letting `packages/fx-bento` in-memory state survive too long. Replace it with read models and transaction builders early.
- Worker jobs must be replay-safe. A duplicate job must not duplicate a transaction or corrupt room state.
- Settlement needs cross-language tests because Solidity scoring and TypeScript result building must agree.

DX review:
- Generated ABIs and typed helpers are required before the API grows.
- Anvil lifecycle tests should become the main local confidence loop.
- Route tests should assert response schemas, not just status codes.
- Health output should tell a developer exactly which dependency is stale: RPC, Ponder, Liveblocks, worker, x402, or env.

Status: DONE_WITH_CONCERNS

Concern:
- This plan was produced without an interactive AskUserQuestion gate because this Codex session does not expose the gstack AskUserQuestion tool. I used the autoplan decision principles directly and preserved open questions instead of silently treating them as settled product choices.

## Autoplan Closure Pass

The review gauntlet found that the scaffold was directionally correct but still exposed simulator behavior on the public FX Bento API. That is now fixed.

Shipped after review:

- Canonical `POST /fx-bento/rooms`, `/join`, `/commit`, `/reveal`, `/settle`, `/leave`, `/refund`, and `/claim` are contract transaction preparation paths.
- The old in-memory game flow moved under `/fx-bento/dev/*` and is disabled outside `development` and `test`.
- Ponder DB projection no longer overwrites known room status with `unknown` on non-status events.
- Liveblocks auth caps normal callers to read/presence permissions; operator-level access requires the API key path.
- Worker job endpoints require an API key outside development/test.
- `/health` now reports missing runtime env and dependency readiness instead of only returning a shallow env parse.
- README route docs now point to `/fx-bento/*`, not stale `/arcade/*`.
- `TODOS.md` captures the remaining product, engine, indexer, worker, API, and DX gates.

Still intentionally blocked before calling this production-ready:

- API reads still need a real Ponder DB/client adapter instead of process-local read models.
- Transaction builders still need `simulateContract` plus Ponder-vs-contract reconciliation before returning production calldata.
- Worker jobs still need durable idempotency, tx hash storage, and Anvil replay before they submit irreversible lifecycle transactions.
- Settlement needs public evidence format, challenge docs, deterministic scorer parity, and an operator failure policy.
- x402 receipts and result allocations use the shared durable persistence adapter.

Final consensus:

| Phase | Decision | Status |
| --- | --- | --- |
| CEO | Build a thin playable vertical before expanding generalized MCP/x402/operator automation | Accepted as product gate |
| Design | Keep Liveblocks realtime-only and never trusted for money state | Implemented in auth defaults |
| Engineering | Canonical routes must prepare contract txs, not mutate simulator rooms | Implemented |
| Engineering | Ponder projection must not corrupt room lifecycle status | Implemented |
| DX | Route docs and tests must match real API shape | Implemented |

Closure status: DONE_WITH_CONCERNS. The backend scaffold now has the right public contract-backed shape, but the durable Ponder/DB/worker/simulation layer remains the next hard gate.

## Full Engine Hardening Pass

Shipped in the next pass:

- API reads now use a Ponder GraphQL read source when `PONDER_GRAPHQL_URL` is configured, with local memory fallback only for dev/test fixture flows.
- FX Bento transaction responses now include safety metadata from viem simulation and room-state reconciliation.
- Room-bound transaction prep checks indexed room status and, when `CONTRACT_RPC_URL` or an RPC fallback is configured, reads `FXBentoRoomFactory.getRoom` before returning calldata.
- Worker jobs, settlement proofs, and x402 receipts now persist through `FX_BENTO_DATABASE_URL`/`PONDER_SQL_URL` in production or SQLite through `FX_BENTO_DB_PATH` locally; legacy `WORKER_JOB_STORE_PATH` and `SETTLEMENT_RESULT_STORE_PATH` are still accepted as SQLite paths.
- Settlement evidence and challenge policy is documented in `docs/settlement-evidence-policy.md` and backed by typed zod schemas in `packages/fx-bento`.

Remaining hard gates:

- Run the simulation/reconciliation path against a live Anvil deployment fixture, not only mock clients.
- Add tx submission and tx hash confirmation to the first irreversible worker job.
- Extend the hardened worker pattern beyond `finalize_results` to round lock/start/anchor/settlement and Liveblocks projection jobs.
- Add production deployment runbooks and alerts for stale RPC, stale Ponder, failed jobs, and stuck rooms.
