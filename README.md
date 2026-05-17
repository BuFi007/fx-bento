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

- `PONDER_GRAPHQL_URL`: optional remote Ponder GraphQL endpoint used by the API for indexed room reads. SQL-only production deployments can omit it.
- `PONDER_SQL_URL`: Postgres-compatible Ponder SQL database URL for indexed room, event, round, player, and market snapshot reads. This should point at the Ponder indexer database, not the app persistence database.
- `FX_BENTO_RPC_URL`: canonical FX Bento RPC endpoint used for viem `simulateContract`, reads, and worker confirmations.
- `FX_BENTO_CHAIN_ID`: canonical chain id for FX Bento backend transaction prep.
- `FX_BENTO_FROM_BLOCK`: canonical Ponder/indexer start block.
- `FX_BENTO_FACTORY_ADDRESS`, `FX_BENTO_ESCROW_ADDRESS`, `FX_BENTO_SETTLEMENT_ADDRESS`, `FX_BENTO_ROUND_MANAGER_ADDRESS`, `FX_BENTO_HOOK_ADDRESS`, `FX_BENTO_POOL_REGISTRY_ADDRESS`, `FX_BENTO_COMMITMENT_MANAGER_ADDRESS`, `FX_BENTO_PROTOCOL_FEE_VAULT_ADDRESS`: direct deployed contract env aliases consumed by the API, worker, and Ponder.
- `CONTRACT_RPC_URL`: legacy/fallback RPC endpoint used for viem `simulateContract` and contract-read reconciliation.
- `CONTRACT_ADDRESSES_JSON`: optional chain-scoped contract address map consumed by API transaction prep and reconciliation; direct `FX_BENTO_*_ADDRESS` envs override it for the active chain.
- `FX_BENTO_DATABASE_URL`: Postgres database URL for worker jobs, settlement proofs, and x402 receipts. Falls back to `DATABASE_PRIVATE_URL`, `DATABASE_URL`, `POSTGRES_URL`, then `PRISMA_DATABASE_URL`.
- `FX_BENTO_DB_PATH`: SQLite DB path for worker jobs, tx confirmation status, settlement allocations, and claim proofs; defaults to `.fx-bento/fx-bento-<env>.sqlite`.
- `WORKER_JOB_STORE_PATH`: legacy fallback path for worker jobs, now interpreted as a SQLite DB path.
- `SETTLEMENT_RESULT_STORE_PATH`: legacy fallback path for settlement allocations/proofs, now interpreted as a SQLite DB path.
- `WORKER_STUCK_JOB_SECONDS`: age threshold for surfacing stuck finalizations in worker health; defaults to `600`.
- `OPERATOR_ALERT_WEBHOOK_URL`: optional production alert sink; worker health, drain, and dashboard requests post `operator.alerts` here when alerts are present.
- `SLACK_BOT_TOKEN`: Slack bot token (`xoxb-…`) used to POST `operator.alerts` to the ops channel via `chat.postMessage`.
- `FX_BENTO_OPS_SLACK_CHANNEL_ID`: Slack channel id (`C0…`) that receives worker health, drain, and dashboard operator alerts. Both env vars must be set for alerts to dispatch; otherwise the sink reports `configured: false`.
- `OPERATOR_ALERT_MIN_SEVERITY`: `warning` or `critical`; defaults to `warning`.
- `OPERATOR_ALERT_DEDUP_SECONDS`: in-process alert dedupe window; defaults to `900`.

## Deployments

Arc Testnet `5042002` is the production backend target:

- RPC: `https://rpc.testnet.arc.network`
- Indexer start block: `42625070`
- Deployer / owner / treasury: `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69`
- PoolManager: `0x3FA22b7Aeda9ebBe34732ea394f1711887363B34`
- PoolRegistry: `0x4d17c86866e6f0eab4908fe4cb4592e56e361084`
- ProtocolFeeVault: `0x468c241484f6aa6bd9555c9533074510dc7d6df1`
- FXBentoHook: `0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0`
- FXBentoRoomFactory: `0x385bbd57d0dc2008e4446af7b12dcd158d56034d`
- FXBentoRoomEscrow: `0xab2f146507854334464c4b2326654775d9d947ed`
- FXBentoRoundManager: `0xfb956d033b15276da21579afd5f5b6bf6320869e`
- FXBentoSettlementManager: `0x8f635571aaea4b1391534cd92932caa839e04bcd`
- FXBentoCommitmentManager: `0x6b2c047fa0deb963a9ede1db7d0e4df258880414`

Avalanche Fuji `43113` is also deployed for test coverage:

- RPC: `https://api.avax-test.network/ext/bc/C/rpc`
- Indexer start block: `55454938`
- PoolManager: `0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C`
- PoolRegistry: `0x2931c50745334d6dff9ec4e3106fe05b49717df1`
- ProtocolFeeVault: `0x7ac83373c6b74c7c5b0eee80fb36239a451dc899`
- FXBentoHook: `0x4959be2392a8a2ac27060c26c8f7d070ada9d0c0`
- FXBentoRoomFactory: `0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1`
- FXBentoRoomEscrow: `0x5d10d2c3b9951054845534b2f60a68ebc0898cd3`
- FXBentoRoundManager: `0x27dbda42adb904115cade37c949bbf670e0ff09d`
- FXBentoSettlementManager: `0xa73208b62af9a87fb5e2b694b27f510d70e17746`
- FXBentoCommitmentManager: `0xaad184861726627968718fde8b94ecac87eb5c5b`

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
