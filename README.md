# FX² Arcade Protocol

FX² Arcade Protocol is a decentralized multiplayer arcade layer for FX markets. FX Bento is the first game: players enter USDC rooms, compete on future price-tile predictions using equal chip budgets, and win from capped player-funded prize pools. Uniswap v4 hooks anchor the game to real market pools, while escrow contracts guarantee that no player or admin can withdraw room funds outside the rules. The protocol earns transparent rake and never takes uncapped directional risk.

## Architecture

- `FXBentoHook.sol`: volatility oracle and market snapshot hook. It validates allowed pools, records pool snapshots, emits market events, and never custodies player escrow.
- `FXBentoRoomFactory.sol`: creates immutable FX Bento room configs.
- `FXBentoRoomEscrow.sol`: holds entry fees, refunds cancelled rooms, settles Merkle prize roots, enforces `payouts + rake <= escrow`.
- `FXBentoRoundManager.sol`: stores round timing, anchors, and settlement prices.
- `FXBentoCommitmentManager.sol`: commit-reveal tile selections with optional EIP-712-style batched commitments.
- `FXBentoScoring.sol`: pure anti-wall validation and fixed-point hit scoring.
- `FXBentoSettlementManager.sol`: MVP attestor/challenge/finalize flow.
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
forge build
forge test
bun install
bun run backend:dev
```

## Status

This is an MVP scaffold with passing Foundry coverage for room creation, joins, max-player limits, min-player lock checks, cancellation refunds, commit-reveal, anti-wall rejection, scoring, settlement, rake, prize claims, double-settlement prevention, and payout invariants.
