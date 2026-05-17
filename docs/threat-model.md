# FX² Arcade Protocol Threat Model

## Assets

- Player entry fees held by `FXBentoRoomEscrow`.
- Prize claims represented by typed settlement payloads and Merkle winner roots.
- Protocol rake claimable only after successful settlement.
- Market snapshots emitted by `FXBentoHook`.
- Commit-reveal integrity for FX Bento tile selections.

## Core Invariant

`totalPrizePayouts + protocolFee <= totalRoomEscrow`

The protocol never pays winners from a vault, never quotes uncapped multipliers, and never takes house-side directional risk.

## Trust Boundaries

- Uniswap v4 hook: market anchoring and event emission only.
- Escrow: source of truth for entry funds, refunds, prize claims, and rake.
- Settlement manager: MVP attestor path with challenge window, owner resolution, and timeout rescue to refunds.
- Offchain app/backend/Liveblocks systems: UX and coordination only. They are not trusted for money and are out of scope for this Solidity repo.

## Main Risks

- Malicious settlement root: mitigated by attestor roles, challenge window in `FXBentoSettlementManager`, typed payout payload validation, Merkle claims, and payout cap checks in escrow.
- Admin fund theft: no arbitrary room escrow withdrawal function exists.
- Double claims: `prizeClaimed` and `protocolFeeClaimed` gates.
- Late selection changes: commit must happen before `lockTime`; reveal must match commitment after lock.
- Wall/spam patterns: scoring and commitment validation reject too many tiles, too many same-row tiles, horizontal chains, duplicate tiles, and full rows/columns.
- Hook overreach: hook does not custody player funds or settle winners, implements canonical v4-core `IHooks`, uses no return-delta permissions, and callback-style snapshot writes are restricted to the configured PoolManager address.
- Hook callback surface: `afterInitialize` imports registry approval into hook-local pool state, and swap callbacks check hook-local allowlist state instead of calling the registry on every swap.
- Round anchoring: round start and settlement require fresh hook snapshots, store anchor and settlement snapshot ids, and final results cannot be submitted until every configured round has ended.
- Payout over-allocation: settlement payloads bind payout total, protocol fee, roster hash, leaderboard hash, score root, settlement price root, and metadata hash; escrow caps claims to the committed payout total and `claimedPrizes + protocolFee <= escrow`.
- Stalled settlement: locked or settling rooms can be cancelled for pull refunds after the settlement rescue deadline if no results were finalized.
- Emergency pause abuse: pause is scoped to new hook swap context and factory room creation; refunds and claims remain available through escrow status.

## MVP Limitations

- The hook uses canonical v4-core interfaces and reads pool state through `StateLibrary`, with CREATE2 planning scripts for address-bit mining.
- Settlement attestation is authorized for MVP; decentralization requires multiple attestors or optimistic dispute proofs.
- Oracle freshness checks are enforced for hook snapshot based round anchoring; external oracle quorum and fallback logic are not implemented yet.
- App, backend, indexer, Liveblocks, and wallet flows are implemented in separate repositories and must treat this protocol as the money source of truth.
