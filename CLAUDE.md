# FX Bento Claude Guidance

This repo follows the same project memory as `AGENTS.md`.

Guiding architecture:

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

Read [docs/architecture-reference.md](docs/architecture-reference.md) before changing the hook, escrow, settlement, or room lifecycle paths.

Use the shared Uniswap skills from `/Users/criptopoeta/.agents/skills`:

- `v4-hook-generator`
- `v4-security-foundations`
- `adversarial-uniswap-hooks`
- `swap-integration`
- `swap-planner`
- `liquidity-planner`
