# FX Bento Protocol TODOs

This repo is protocol-only. Keep application, backend, indexer, Liveblocks, and frontend work out of this repository.

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
- Invariant coverage for active roster accounting, outstanding escrow, prize claims, protocol fee claims, and no token creation.
- v4 hook permission-bit validation and real PoolManager snapshot integration tests.

Before public paid-room usage:

- Complete external security review.
- Add deployment runbooks for hook address mining, deployment, verification, and role setup.
- Add chain-specific pool/oracle allowlist review.
- Add compliance review for wording, entry/prize mechanics, jurisdictional exposure, and access controls.

## P1 Protocol Work

- Expand settlement attestation to typed EIP-712 signatures.
- Add multi-attestor settlement and challenge quorum rules.
- Add oracle fallback policy for Pyth, Chainlink, RedStone, and Uniswap v4 TWAP.
- Add deployment scripts for each supported testnet/mainnet target.
- Add gas reports for common room lifecycle paths.
- Add explicit pause/rescue runbooks.
- Add NatSpec coverage for all external methods and state-transition errors.

## Out Of Scope For This Repo

- Backend coordinator.
- Indexer/Ponder services.
- Liveblocks integration.
- Frontend UI.
- Wallet CTA handling.
- TypeScript SDK packages.
