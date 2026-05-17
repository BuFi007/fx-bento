# FX Bento Agent Guidance

This repository contains the Solidity protocol for **FX² Arcade Protocol** and its first game, **FX Bento**.

Guiding architecture:

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

Preserve this boundary in every change:

- `FXBentoHook.sol` is the Uniswap v4 market integration layer. It records pool snapshots, exposes volatility/market observations, validates allowed pools, and emits settlement/indexer events.
- `FXBentoHook.sol` must not custody room entry funds, settle winners, store large leaderboards, or distribute prizes.
- `FXBentoRoomEscrow.sol` owns room accounting, refunds, protocol rake accounting, and pull-based prize claims.
- `FXBentoSettlementManager.sol` owns results roots, attestation/challenge/finalization flow, and winner verification.
- Offchain applications coordinate UX only and must live outside this repo. Contracts remain the source of truth for entry payments, escrow, commitments, refunds, settlement, prize claims, and protocol fee claims.

Use the shared Uniswap skills when working on the hook path:

- `[$v4-hook-generator](/Users/criptopoeta/.agents/skills/v4-hook-generator/SKILL.md)`
- `[$v4-security-foundations](/Users/criptopoeta/.agents/skills/v4-security-foundations/SKILL.md)`
- `[$adversarial-uniswap-hooks](/Users/criptopoeta/.agents/skills/adversarial-uniswap-hooks/SKILL.md)`

Before finishing changes, run:

```bash
forge fmt --check
forge build
forge test
```
