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

`test/FXBentoHookV4Integration.t.sol` covers the local `PoolManager` path with a permissioned hook address, real pool initialization, real liquidity modification, and a real swap. It does not replace the HookMiner/CREATE2 deployment script needed for testnet and production deployment.

## Salt Mining

For a full aggregate deployment, first run the planner. It predicts the `PoolRegistry` and `ProtocolFeeVault` addresses from the deployer nonce, then mines a hook salt using those exact constructor arguments.

```bash
DEPLOYER=0x... \
DEPLOYER_NONCE=123 \
OWNER=0x... \
TREASURY=0x... \
POOL_MANAGER=0x... \
HOOK_MINE_ATTEMPTS=5000000 \
forge script script/PlanFXBentoDeployment.s.sol --sig "run()"
```

If `DEPLOYER_NONCE` is omitted, the script reads the current nonce from the connected execution context. Use an RPC URL or provide the nonce explicitly for testnet/mainnet planning.

The deployer nonce must not change between planning and broadcast. If any transaction is sent from the deployer, re-run the planner and use the new salt.

For a hook-only deployment where registry and vault already exist, use the lower-level mining script with the final constructor arguments and CREATE2 deployer address. Constructor arguments affect the init code hash, so changing `OWNER`, `POOL_MANAGER`, `POOL_REGISTRY`, or `PROTOCOL_FEE_VAULT` changes the predicted address.

```bash
CREATE2_DEPLOYER=0x... \
OWNER=0x... \
POOL_MANAGER=0x... \
POOL_REGISTRY=0x... \
PROTOCOL_FEE_VAULT=0x... \
HOOK_MINE_ATTEMPTS=5000000 \
forge script script/MineFXBentoHookSalt.s.sol --sig "run()"
```

The script prints:

- CREATE2 deployer
- predicted `FXBentoHook` address
- salt

The printed address must satisfy `hookAddressHasPermissions(address) == true` before deployment.

`FXBentoHook` enforces `Hooks.validateHookPermissions` in its constructor. A deployment to any address whose low bits do not exactly match the enabled permissions will revert.

The aggregate deployment script expects the mined salt:

```bash
OWNER=0x... \
TREASURY=0x... \
POOL_MANAGER=0x... \
HOOK_SALT=0x... \
forge script script/DeployFXBento.s.sol --broadcast --rpc-url "$RPC_URL"
```
