# FX Bento Protocol Architecture Reference

This document is scoped to the Solidity protocol repository.

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

## Repository Boundary

This repo owns:

- Solidity contracts in `src/`.
- Foundry tests and invariants in `test/`.
- Deployment and planning scripts in `script/`.
- Protocol security, lifecycle, payout, and hook deployment documentation in `docs/`.

This repo does not own:

- Frontend UI.
- Backend coordinator.
- Indexer/Ponder services.
- Liveblocks integration.
- Wallet CTA handling.
- TypeScript SDK packages.

Those systems may integrate with this protocol, but they must treat onchain state as the source of truth.

## Contract Modules

### `FXBentoHook.sol`

Uniswap v4 market integration layer.

Responsibilities:

- Validate hook permission bits at construction.
- Cache allowed pool state after pool initialization.
- Record PoolManager-backed price snapshots after swaps.
- Expose latest snapshots and realized volatility.
- Emit market snapshot events for offchain indexers.

Non-responsibilities:

- No player room escrow.
- No prize distribution.
- No final winner decisions.
- No room leaderboards.

### `FXBentoRoomFactory.sol`

Creates immutable room configuration.

Validates:

- allowed entry token
- allowed pool
- rake cap
- player limits
- payout split
- start time
- round duration and lock buffer

### `FXBentoRoomEscrow.sol`

Owns room accounting and funds.

Responsibilities:

- entry fee collection
- lobby leave
- cancellation refunds
- room lock
- typed payout root storage
- Merkle prize claims
- protocol fee claims
- lifecycle accounting invariants

Critical invariant:

```text
totalPrizePayouts + protocolFee <= totalRoomEscrow
```

### `FXBentoRoundManager.sol`

Owns round timing and market snapshot binding.

Responsibilities:

- start rounds from fresh hook snapshots
- store anchor snapshot ids
- record settlement from later fresh hook snapshots
- expose `allRoundsEnded(roomId)` for settlement gating

### `FXBentoCommitmentManager.sol`

Owns commit-reveal tile selections.

Responsibilities:

- paid active player checks
- pre-lock commitments
- post-lock reveal validation
- anti-wall pattern validation
- batched commitment signature support

### `FXBentoSettlementManager.sol`

Owns MVP result submission, challenge, and finalization.

Responsibilities:

- authorized attestor result submission
- typed payout root validation
- challenge window
- accepted/rejected challenge resolution
- finalization into escrow
- timeout rescue to cancellation/refunds

### `PoolRegistry.sol`

Allowed pool registry used by room creation and hook pool validation.

### `ProtocolFeeVault.sol`

Receives protocol rake after successful room settlement.

## Lifecycle

1. Register allowed pool.
2. Create room.
3. Players join by paying entry token into escrow.
4. Room locks after start time if minimum players are present.
5. Rounds start from fresh hook snapshots.
6. Players commit before lock time.
7. Players reveal after lock time.
8. Rounds settle from later fresh hook snapshots.
9. Authorized attestor submits typed payout root.
10. Challenge window resolves.
11. Settlement finalizes to escrow.
12. Winners claim prizes and protocol claims rake through pull payments.

If room start or settlement fails, cancellation/rescue paths preserve refunds.

## Validation

Before merging protocol changes, run:

```bash
forge fmt --check
forge build
forge test
```

The current suite covers room lifecycle, hook snapshots, round snapshot freshness, commit-reveal, settlement challenges, rescue refunds, payout caps, and accounting invariants.
