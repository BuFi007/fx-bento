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

Complete in the MVP scaffold:

- Backend room state is explicitly mock/indexer-facing, not money-authoritative.
- Backend can ingest contract-style room lifecycle events and persist replay/idempotency state locally.
- Backend can poll configured contract logs with viem and feed the same event-derived state path.
- Liveblocks auth requires active room membership unless spectator mode is requested.
- Commit/reveal endpoints are relay-only, idempotent, room-status gated, and commitment signatures can be verified against the Solidity digest.

Remaining P1 production work:

- Move poller state from local JSON to production persistence.
- Add deployment-specific event address configuration.
- Verify on-chain room membership/status before granting room access in production mode.
- Persist commitment, reveal, settlement, and leaderboard inputs.
- Add typed EIP-712 result attestation schema.

## P1 Frontend / SDK

- SDK transaction builders now cover create/join/leave/cancel/refund/lock/commit/reveal/claim/settlement/challenge/rescue.
- SDK state helpers now expose room-status CTA gating.
- Frontend lobby and room surfaces now consume backend room state and `roomFlowActions(...)` for join/refund/settlement/challenge/claim rendering.

Remaining P1 production work:

- Implement full UI state matrix from the architecture reference.
- Add wallet-backed transaction handlers to the rendered room CTAs.
- Expand board-first mobile layout with sticky timer and commit/reveal controls.
- Add replayable result explanation: selected tiles, price path, hit/miss, multiplier, coverage penalty, score delta, rank, prize.
- Add SDK market, settlement, Liveblocks, and wallet state helpers.
