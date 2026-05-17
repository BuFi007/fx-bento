# FXBentoHook v4 Deployment Notes

`FXBentoHook` is intentionally a market anchor, not the FX Bento game engine:

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

## Enabled Permissions

The hook currently enables only the callbacks needed for market snapshots:

- `afterInitialize`
- `beforeSwap`
- `afterSwap`

All return-delta permissions are disabled. The hook must never return non-zero swap deltas, move player room funds, settle prizes, or custody room escrow.

The required permission bitmap is:

```solidity
Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
```

Use `FXBentoHook.hookPermissionBitmap()` and `FXBentoHook.hookAddressHasPermissions(address)` in deployment tests to verify the deployed address.

## Production Gate

Before attaching the hook to a real v4 pool:

1. Deploy with HookMiner or CREATE2 so the hook address lower bits match the enabled permissions.
2. Run an integration test against a real local `PoolManager`.
3. Confirm all callbacks are called only by the configured `PoolManager`.
4. Confirm `beforeSwap` returns `BeforeSwapDeltaLibrary.ZERO_DELTA` and zero fee override.
5. Confirm `afterSwap` only records the `StateLibrary.getSlot0` snapshot and emits market events.
6. Confirm disabled callbacks revert and no return-delta flags are enabled.

The current unit tests use a mock PoolManager for deterministic snapshot tests. They do not replace the HookMiner and real PoolManager deployment gate.
