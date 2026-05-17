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

## Product Surface

Frontend mode: **FX Bento Arcade**

Lobby copy:

- “FX² Arcade Protocol”
- “Play FX Bento”
- “Join kawaii FX prediction rooms. Same chips. Same market. Highest score wins.”

Backend endpoints:

- `POST /arcade/rooms`
- `GET /arcade/rooms`
- `GET /arcade/rooms/:id`
- `POST /arcade/rooms/:id/join-intent`
- `POST /arcade/rooms/:id/commit`
- `POST /arcade/rooms/:id/reveal`
- `GET /arcade/rooms/:id/leaderboard`
- `POST /arcade/rooms/:id/settle`

## Commands

```bash
forge fmt --check
forge build
forge test
bun run typecheck
bun run verify
forge script script/PlanFXBentoDeployment.s.sol --sig "run()"
bun install
bun run backend:dev
```

## Status

This is an MVP scaffold with passing Foundry coverage for room creation, joins, max-player limits, min-player lock checks, clean cancellation/refund failure paths, paid active membership, commit-reveal, anti-wall rejection, scoring, hook snapshots, round anchoring, typed settlement payloads, challenge resolution, timeout rescue refunds, rake, prize claims, double-settlement prevention, and lifecycle accounting invariants.

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
