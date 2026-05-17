# FX² Arcade Protocol Threat Model

## Assets

- Player entry fees held by `FXBentoRoomEscrow`.
- Prize claims represented by settlement Merkle roots.
- Protocol rake claimable only after successful settlement.
- Market snapshots emitted by `FXBentoHook`.
- Commit-reveal integrity for FX Bento tile selections.

## Core Invariant

`totalPrizePayouts + protocolFee <= totalRoomEscrow`

The protocol never pays winners from a vault, never quotes uncapped multipliers, and never takes house-side directional risk.

## Trust Boundaries

- Uniswap v4 hook: market anchoring and event emission only.
- Escrow: source of truth for entry funds, refunds, prize claims, and rake.
- Settlement manager: MVP attestor path with challenge window.
- Backend and Liveblocks: UX and coordination only. They are not trusted for money.

## Main Risks

- Malicious settlement root: mitigated by attestor roles, challenge window in `FXBentoSettlementManager`, Merkle claims, and payout cap checks in escrow.
- Admin fund theft: no arbitrary room escrow withdrawal function exists.
- Double claims: `prizeClaimed` and `protocolFeeClaimed` gates.
- Late selection changes: commit must happen before `lockTime`; reveal must match commitment after lock.
- Wall/spam patterns: scoring and commitment validation reject too many tiles, too many same-row tiles, horizontal chains, duplicate tiles, and full rows/columns.
- Hook overreach: hook does not custody player funds or settle winners, implements canonical v4-core `IHooks`, uses no return-delta permissions, and callback-style snapshot writes are restricted to the configured PoolManager address.
- Emergency pause abuse: pause is scoped to new hook swap context and factory room creation; refunds and claims remain available through escrow status.

## MVP Limitations

- The hook uses canonical v4-core interfaces and reads pool state through `StateLibrary`, but production deployment still needs a HookMiner/CREATE2 deployment script for address-bit mining.
- Settlement attestation is authorized for MVP; decentralization requires multiple attestors or optimistic dispute proofs.
- Oracle freshness checks are modeled in registry metadata but not fully enforced in settlement.
- Frontend and backend are product skeletons, not production wallet flows.
