# FX² Arcade Protocol

Solidity protocol contracts for **FX² Arcade Protocol** and its first game, **FX Bento**.

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

This repository is the protocol repo. It should stay focused on Foundry contracts, deployment scripts, protocol tests, invariants, and security documentation. App, backend, indexer, Liveblocks, and frontend work belongs in separate repositories.

## Thesis

FX² Arcade Protocol is a decentralized multiplayer arcade layer for FX markets. FX Bento is the first game: players enter USDC rooms, compete on future price-tile predictions using equal chip budgets, and win from capped player-funded prize pools. Uniswap v4 hooks anchor the game to real market pools, while escrow contracts guarantee that no player or admin can withdraw room funds outside the rules. The protocol earns transparent rake and never takes uncapped directional risk.

## Protocol Boundary

- `FXBentoHook.sol`: Uniswap v4 market snapshot hook. It caches allowed pools after initialization, records indexed PoolManager snapshots, exposes market observations, emits settlement/indexer events, and never custodies player escrow.
- `FXBentoRoomFactory.sol`: creates immutable FX Bento room configs.
- `FXBentoRoomEscrow.sol`: holds entry fees, refunds cancelled rooms, stores typed payout-root metadata, settles Merkle prize roots, and enforces `payouts + rake <= escrow`.
- `FXBentoRoundManager.sol`: stores round timing, fresh anchor snapshot ids, and settlement snapshot ids.
- `FXBentoCommitmentManager.sol`: commit-reveal tile selections with optional batched commitments.
- `FXBentoScoring.sol`: pure anti-wall validation and fixed-point hit scoring.
- `FXBentoSettlementManager.sol`: MVP attestor/challenge/finalize flow with typed payout validation and timeout rescue.
- `PoolRegistry.sol`: allowed FX pool registry.
- `ProtocolFeeVault.sol`: receives protocol rake.

The hook is the market integration layer, not the game engine. Escrow, commit-reveal, scoring, settlement, refunds, and prize distribution remain isolated contracts.

## Commands

```bash
git submodule update --init --recursive
forge fmt --check
forge build
forge test
forge script script/PlanFXBentoDeployment.s.sol --sig "run()"
```

If using the convenience npm scripts:

```bash
npm run verify
```

## Current Coverage

Foundry coverage includes:

- room creation and invalid config rejection
- joins, leaves, max-player limits, and min-player lock checks
- cancellation, refunds, failed start, and rescue paths
- paid active membership checks for commit/reveal and prize eligibility
- commit-reveal mismatch, late commit, wall-pattern, and tile-limit rejection
- scoring hit/miss and coverage penalty paths
- v4 hook permission-bit validation and real PoolManager snapshot integration
- fresh/stale round anchor and settlement snapshot binding
- typed payout root validation
- challenge acceptance/rejection/finalization
- rake, prize claims, double-claim, and double-settlement prevention
- lifecycle accounting invariants for escrow, prize claims, protocol fees, and token conservation

## Documentation

- `AGENTS.md`: protocol architecture guidance for agents.
- `docs/architecture-reference.md`: validation-first protocol architecture.
- `docs/hook-deployment.md`: v4 permission-bit and hook deployment notes.
- `docs/p0-validation-qa.md`: room-first QA matrix.
- `docs/payout-root-schema.md`: strict settlement payout payload schema.
- `docs/room-lifecycle.md`: room lifecycle and state transitions.
- `docs/threat-model.md`: trust boundaries and limitations.
- `TODOS.md`: protocol implementation queue.
