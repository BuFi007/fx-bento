# P1 Backend and SDK Slice

This slice turns the scaffold into a contract-aligned application surface without changing the core money boundary.

## SDK

`sdk/src/index.ts` now exposes:

- Room status constants for `Lobby`, `Locked`, `Settling`, `Settled`, and `Cancelled`.
- `roomFlowActions(...)` for frontend CTA gating from indexed contract state.
- Transaction builders for create, join, leave, cancel, refund, lock, commit, batched commit, reveal, claim prize, protocol fee claim, submit results, challenge, finalize, and rescue.
- Commitment digest helpers that match `FXBentoCommitmentManager`'s Solidity signature path.

The SDK helpers prepare transaction calldata only. They do not infer player eligibility or mutate room state.

## Backend Coordinator

`backend/src/server.ts` remains an MVP in-memory coordinator, but now follows contract semantics:

- `POST /arcade/rooms` creates a mock/indexed room record for local validation.
- `POST /arcade/rooms/:id/join-intent` records intent and can mark a local mock join as confirmed with `mockConfirmed: true`.
- `POST /arcade/rooms/:id/commit` requires active room membership, idempotently records commitments, and verifies optional batch signatures against the contract digest.
- `POST /arcade/rooms/:id/reveal` requires active room membership, validates anti-wall selection rules, and idempotently records reveals.
- `POST /arcade/rooms/:id/settle` moves locked rooms into settling and stores result metadata for the realtime UX.
- `POST /liveblocks/auth` grants Liveblocks access only to active players, or spectators when explicitly requested.

This backend still does not custody funds, decide final payouts, or become the source of truth for claims/refunds. It is a relay and realtime coordinator.

## Next P1 Work

- Replace in-memory room records with event-derived persistence from contract logs.
- Add a real indexer sync path for `RoomCreated`, `RoomJoined`, `RoomLeft`, `RoomLocked`, `RoomCancelled`, `RoomSettled`, `PrizeClaimed`, and `Refunded`.
- Add persistent idempotency keys for commitment/reveal relay jobs.
- Add frontend components that consume `roomFlowActions(...)` directly.
- Add integration tests for backend routes once the persistence layer is chosen.
