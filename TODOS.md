# FX Bento Implementation TODOs

These tasks are deferred from `/autoplan` and should be handled before public paid-room usage.

## P0 Contract Safety

Complete in the MVP scaffold:

- Escrow active roster, leave/rejoin, refund, and room-full accounting.
- `FXBentoSettlementManager` is the authoritative settlement path for escrow roots.
- Room status changes use the factory lifecycle transition table.
- Paid active membership is required for commit/reveal and prize eligibility.
- Lifecycle accounting invariants cover joins, leaves, lock, rescue cancel, refunds, settlement, prize claims, and protocol fee claims.

No open P0 contract-safety tasks remain in this file.

## P0 Validation

Complete in the MVP scaffold:

- Room-first contract QA matrix for failed start, cancel, refund, settle, claim, challenge, and rescue paths.
- SDK room-status assumptions and CTA gating helper.
- Invariant coverage for active roster accounting, outstanding escrow, prize claims, protocol fee claims, and no token creation.

Product validation gates before paid public rooms:

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
