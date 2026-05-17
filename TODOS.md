# FX Bento Implementation TODOs

These tasks are deferred from `/autoplan` and should be handled before public paid-room usage.

## P0 Contract Safety

- Refactor `FXBentoHook.sol` into a canonical Uniswap v4 `BaseHook`.
- Enforce `PoolManager`-only hook callbacks and permission-bit deployment tests.
- Repair escrow active roster, leave/rejoin, refund, and room-full accounting.
- Make `FXBentoSettlementManager` the authoritative settlement path for escrow roots.
- Replace arbitrary room status writes with a room lifecycle transition table.
- Add challenge resolution, timeout, adjudication, or refund rescue.
- Bind rounds to room config, valid round indexes, grid hash, and fresh market snapshots.
- Require paid active membership for commit/reveal and prize eligibility.
- Define payout root schema with total allocation, fee total, roster, rankings, score root, and settlement price root.
- Add invariant tests for `claimed prizes + claimed fees + refundable/current escrow accounting <= token balance`.

## P0 Validation

- Build a room-first validation lobby and board-first game loop.
- Validate room fill, score comprehension, refund comprehension, and replay/rematch interest.
- Decide whether first validation mode includes free-play rooms before paid testnet rooms.
- Add compliance review for wording, entry/prize mechanics, jurisdictional exposure, and access controls.

## P1 Backend / Realtime

- Treat backend room state as event-derived or explicitly mock-only.
- Add wallet auth before issuing Liveblocks tokens.
- Verify on-chain room membership/status before granting room access.
- Make commit/reveal endpoints relay-only, typed, idempotent, and signature-verified.
- Persist commitment, reveal, settlement, and leaderboard inputs.
- Add typed EIP-712 result attestation schema.

## P1 Frontend / SDK

- Implement full UI state matrix from the architecture reference.
- Convert lobby to room-first hierarchy.
- Implement board-first mobile layout with sticky timer and commit/reveal controls.
- Add replayable result explanation: selected tiles, price path, hit/miss, multiplier, coverage penalty, score delta, rank, prize.
- Add SDK transaction builders for room create/join/refund/commit/reveal/claim.
- Add SDK state helpers for room, market, settlement, Liveblocks, and wallet states.
