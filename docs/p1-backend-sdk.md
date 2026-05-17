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
- `POST /arcade/events` ingests contract-style events and derives room state from them.
- `POST /liveblocks/auth` grants Liveblocks access only to active players, or spectators when explicitly requested.

This backend still does not custody funds, decide final payouts, or become the source of truth for claims/refunds. It is a relay and realtime coordinator.

## Event-Derived State

The local coordinator persists replay state to `FX_BENTO_STATE_PATH`, defaulting to `.fx-bento/backend-state.json`.

Supported event names:

- `RoomCreated`
- `RoomJoined`
- `RoomLeft`
- `Refunded`
- `RoomLocked`
- `ResultsSubmitted`
- `ResultsChallenged`
- `ChallengeResolved`
- `RoomSettled`
- `RoomCancelled`
- `SettlementRescued`

Event ids are derived from `txHash:logIndex` when present. Otherwise the backend derives a deterministic local id from the event payload. Replayed events are skipped.

Commit and reveal routes accept an optional `idempotencyKey`. A repeated request with the same key and same commitment/reveal hash is accepted as idempotent. A repeated key with different payload is rejected.

## Chain Log Poller

The backend can feed `/arcade/events` automatically with viem log polling.

Environment:

```bash
FX_BENTO_RPC_URL=https://...
FX_BENTO_CHAIN_ID=84532
FX_BENTO_FROM_BLOCK=0
FX_BENTO_POLL_INTERVAL_MS=12000
FX_BENTO_FACTORY_ADDRESS=0x...
FX_BENTO_ESCROW_ADDRESS=0x...
FX_BENTO_SETTLEMENT_ADDRESS=0x...
FX_BENTO_STATE_PATH=.fx-bento/backend-state.json
```

At least one contract address is required. `FX_BENTO_RPC_URL` must be `https://` for remote RPCs. Local development may use `http://localhost`, `http://127.0.0.1`, or `http://[::1]`.

When configured, the poller starts on boot and advances a persisted `pollerCursorBlock`. Operators can also trigger one poll manually:

```bash
curl -X POST http://localhost:8787/arcade/indexer/poll
```

## Next P1 Work

- Add production persistence around the poller state instead of local JSON.
- Add deployment-specific event address configuration.
- Wire deployed contract addresses into `FX_BENTO_FACTORY_ADDRESS`, `FX_BENTO_ESCROW_ADDRESS`, and `FX_BENTO_SETTLEMENT_ADDRESS` after deployment.
- Expand frontend transaction handlers from rendered CTA state.
- Add integration tests for backend routes once the persistence layer is chosen.

## Frontend State Surface

`frontend/src/components/FXBentoArcade.tsx` now consumes backend rooms when available and falls back to sample validation rooms when the backend is offline.

The lobby and room surfaces render from contract-aligned fields:

- `status` / `statusLabel`
- `activePlayers`
- `commitments`
- `reveals`
- `leaderboard`
- `resultsRoot`
- `challengeOpen`
- `settlementRescueDeadline`
- `actions` from `roomFlowActions(...)`

The UI does not decide money state. It only renders room actions that should be backed by contract reads or indexed backend state.
