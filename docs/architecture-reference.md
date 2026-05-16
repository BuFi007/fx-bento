# FX² Arcade Protocol Architecture Reference

Existing repo:

- Local path: `/Users/criptopoeta/Documents/fx-bento-arcade`
- Remote: `git@github.com:BuFi007/fx-bento.git`
- Branch: `main`
- Initial pushed commit: `e6535d8 Initial FX Bento protocol scaffold`

## Guiding Boundary

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

This is the core architectural rule for the project.

## Product

**FX² Arcade Protocol** is a decentralized multiplayer arcade layer for FX/stablecoin markets.

The first game is **FX Bento**.

FX Bento is a kawaii, square-tile, multiplayer FX prediction game. Players join live rooms with a fixed USDC entry fee, receive the same chip budget, place chips on future price tiles, and compete for score. Winners are paid from the capped player-funded prize pool. The protocol earns transparent rake and never takes uncapped directional risk.

## Hook References

Use these Uniswap v4 hook patterns as references:

- Volatility Oracle / Dynamic Fee: price snapshots, volatility buckets, tile difficulty.
- UniMarket / prediction-market hook: prediction-game market anchoring.
- Unimon / game-in-hook: proof that game mechanics can exist around a v4 hook, while FX Bento keeps custody and scoring outside the hook.

Start from a Uniswap v4 `BaseHook` template with Foundry tests.

## Architecture Decision

The Uniswap v4 hook is the market integration layer, not the whole game.

`FXBentoHook.sol` should:

- Anchor FX Bento rooms to real Uniswap v4 pools.
- Record pool price snapshots.
- Expose market and volatility observations.
- Emit events for indexers and game settlement.
- Optionally collect arcade-related swap/rake fees later.
- Never custody player room escrow.
- Never decide final winners alone.
- Never distribute player prizes directly.

Room escrow, commit-reveal, scoring, settlement, refunds, and prize distribution live in dedicated contracts.

## Naming

- Protocol: FX² Arcade Protocol
- Game: FX Bento
- Hook: `FXBentoHook.sol`
- Room Factory: `FXBentoRoomFactory.sol`
- Room Escrow: `FXBentoRoomEscrow.sol`
- Round Manager: `FXBentoRoundManager.sol`
- Commitment Manager: `FXBentoCommitmentManager.sol`
- Scoring Library: `FXBentoScoring.sol`
- Settlement Manager: `FXBentoSettlementManager.sol`
- Fee Vault: `ProtocolFeeVault.sol`
- Frontend mode: FX Bento Arcade
- UI CTA: Play FX Bento

## Core Invariant

The protocol must never distribute more than the room escrow contains:

```text
totalPrizePayouts + protocolFee <= totalRoomEscrow
```

The protocol does not pay users from an uncapped vault. Players compete against each other. The protocol only earns transparent rake.

## Game Rules

- Rooms have a market pair such as USDC/EURC, USDC/MXNB, USDC/BRL, or USDC/ETH.
- Rooms have multiple rounds.
- Every player receives the same chip budget per round.
- The board is a square tiled bento grid.
- Vertical axis = price bands.
- Horizontal axis = future time windows.
- Players can only select future tiles.
- Tiles near the current-time cursor are locked.
- A tile hits if the oracle/pool reference price lands inside that tile's price band during that tile's time window.
- Harder/farther tiles score more points.
- Easier/closer tiles score fewer points.
- Selecting more tiles increases hit probability but reduces score per hit.
- Concentrated predictions have higher upside.
- Spread predictions are safer but weaker.
- Walls and spam patterns are invalid or decay to near-zero score.

## Anti-Abuse Rules

- Max selected tiles per round: 5.
- Max tiles per row: 2.
- Max adjacent horizontal tiles: 2.
- No full-row walls.
- No full-column walls.
- Only future columns are selectable.
- Tiles lock before their time window begins.
- No last-second sniping.
- Invalid patterns are rejected before commit or scored as zero based on room config.

## Scoring

Use fixed-point integer math:

```text
baseScore = tileDifficultyScore
coveragePenalty = 1 / selectedTileCount^0.85
finalHitScore = baseScore * coveragePenalty
```

Approximate examples:

- 1 selected tile = 1.00x score value
- 2 selected tiles = ~0.55x per hit
- 3 selected tiles = ~0.39x per hit
- 5 selected tiles = ~0.25x per hit

Difficulty uses:

- Distance from anchor price.
- Time window distance.
- Volatility bucket.
- Grid config.

## Contract Responsibilities

`FXBentoHook.sol`:

- Build as a custom Uniswap v4 hook using `BaseHook`.
- Permissions: `afterInitialize`, `afterSwap`, optional `beforeSwap`, optional donate callbacks only if implementing sponsored prize donations.
- Store latest pool snapshots.
- Maintain a lightweight ring buffer of observations per `PoolId`.
- Expose `latestSnapshot(poolId)` and `realizedVolatility(poolId, window)`.
- Never hold player escrow or distribute prizes.

`PoolRegistry.sol`:

- Track allowed FX/stablecoin pools.
- Include pool id, `PoolKey`, base/quote token, oracle source, allowed flag, max stale seconds, hook address, and metadata URI.

`FXBentoRoomFactory.sol`:

- Create immutable game room configs.
- Validate allowed pool, allowed entry token, rake cap, payout sum, player bounds, and future start time.

`FXBentoRoomEscrow.sol`:

- Hold entry fees per room.
- Handle joins, leaves before start, cancellation refunds, locks, settlement roots, prize claims, and protocol rake claims.
- No arbitrary admin withdrawal.
- Pull payments only.

`FXBentoRoundManager.sol`:

- Store round timing, lock time, anchor price, settlement price, market snapshot id, grid config hash, and status.

`FXBentoCommitmentManager.sol`:

- Commit-reveal tile selections.
- Commitment hash: `hash(chainId, roomId, roundIndex, player, selectedTilesHash, nonce)`.
- Support EIP-712 signed commitments for gasless/batched UX.

`FXBentoScoring.sol`:

- Pure deterministic scoring and anti-wall validation.

`FXBentoSettlementManager.sol`:

- Authorized attestor posts results roots for MVP.
- Results root commits to scores, rankings, round settlement prices, and selection proofs.
- Optional challenge window.
- Finalized results unlock Merkle prize claims.

`ProtocolFeeVault.sol`:

- Receives protocol rake.
- MVP sends rake to treasury with accounting events.

## Frontend And Realtime

Frontend mode: **FX Bento Arcade**.

Lobby copy:

- “FX² Arcade Protocol”
- “Play FX Bento”
- “Kawaii FX prediction rooms. Same chips. Same market. Highest score wins.”

Use Liveblocks for waiting room presence, player list, cursors, tile hover, selected tile preview, countdown sync, leaderboard updates, chat/reactions, and spectators.

Do not trust Liveblocks for money.

Contracts are the source of truth for entry payments, escrow, commitments, refunds, settlement, prize claims, and protocol fee claims.

## Backend

Use Hono + Bun for:

- Room coordinator.
- Liveblocks auth endpoint.
- Market data streamer.
- Oracle snapshot worker.
- Commitment batcher.
- Settlement attestor for MVP.
- Leaderboard calculator.
- Result publisher.

## Security Requirements

- OpenZeppelin `SafeERC20`.
- `ReentrancyGuard`.
- `Pausable`.
- `AccessControl` or `Ownable` with timelock for sensitive changes.
- Max rake cap.
- Immutable active room rules.
- No arbitrary admin withdrawal.
- Emergency pause must not block refunds or prize claims.
- Pull payments for prizes.
- Event emission for every state transition.
- External calls after state updates.
- Room accounting isolated by `roomId`.
- Settlement cannot exceed escrow.
- Prize claims cannot exceed Merkle allocation.

## Shared Skills

Both Claude and Codex point to the same shared skills in `/Users/criptopoeta/.agents/skills`:

- `v4-hook-generator`
- `v4-security-foundations`
- `adversarial-uniswap-hooks`
- `v4-sdk-integration`
- `swap-integration`
- `swap-planner`
- `liquidity-planner`
- `viem-integration`

Use this sequence for the hook path:

1. `v4-hook-generator`
2. `v4-security-foundations`
3. `adversarial-uniswap-hooks`
4. `v4-sdk-integration`
5. `viem-integration`

## Verification

Before finishing contract work:

```bash
forge fmt --check
forge build
forge test
```

Before finishing TypeScript work:

```bash
bun run typecheck
```
