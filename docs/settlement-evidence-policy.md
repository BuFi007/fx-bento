# FX Bento Settlement Evidence And Challenge Policy

FX Bento settlement is allowed to use an authorized attestor for the MVP, but every submitted result must be publicly inspectable and challengeable.

## Evidence Payload

Every `ResultsSubmitted` action must have a public evidence payload referenced by `metadataURI`.

Required fields:

- `version`: `fx-bento-settlement-evidence-v1`
- `chainId`
- `roomId`
- `resultsRoot`
- `metadataURI`
- `scorerVersion`
- `generatedAt`
- `challengeWindowEndsAt`
- `rounds`: anchor price, settlement price, and tx hashes when available
- `allocations`: player, score, rank, and payout amount
- `totalPrizePayouts`
- `protocolFee`
- `attestor`

The backend must reject evidence when `sum(allocations.amount) !== totalPrizePayouts`.

## Challenge Reasons

Challenges should use one of these reason codes:

- `bad_price`: anchor or settlement price does not match the indexed/contract source.
- `bad_score`: score calculation differs from the published scorer version.
- `bad_allocation`: payout allocation does not match rank, payout bps, or escrow coverage.
- `missing_data`: evidence omits a required event, round, player, or price reference.
- `operator_error`: the attestor submitted the wrong room, root, metadata URI, or stale data.
- `other`: the challenger must include a human-readable explanation in the evidence URI.

## Operator Policy

- Do not submit a results root without a reachable evidence payload.
- Do not finalize while a challenge is active.
- Do not publish a payout tree unless `totalPrizePayouts + protocolFee <= escrowed`.
- Recompute evidence from indexed events and reconcile critical fields against direct contract reads before submission.
- If the indexer is stale, delay submission instead of filling missing data from Liveblocks or client payloads.

## Public User States

The UI/API should expose these settlement states:

- `pending_results`: room finished, no results root submitted.
- `challenge_window`: results root submitted and challenge window open.
- `challenged`: challenge exists; claims must remain blocked.
- `finalized`: results finalized; claim proofs may be served.
- `operator_blocked`: backend found stale indexer, stale oracle, invalid evidence, or failed reconciliation.

Contracts settle money. The backend publishes evidence, checks consistency, and coordinates the workflow.
