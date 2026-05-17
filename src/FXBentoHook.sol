// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "./libraries/Guards.sol";
import {PoolId as FXPoolId, PoolKey as FXPoolKey, PoolIdLibrary as FXPoolIdLibrary} from "./libraries/FXBentoTypes.sol";
import {PoolRegistry} from "./PoolRegistry.sol";
import {ProtocolFeeVault} from "./ProtocolFeeVault.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolId as V4PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey as V4PoolKey} from "v4-core/types/PoolKey.sol";

contract FXBentoHook is IHooks, Pausable {
    using FXPoolIdLibrary for FXPoolKey;

    struct PoolSnapshot {
        uint160 sqrtPriceX96;
        int24 tick;
        uint64 timestamp;
        uint256 volatility;
    }

    uint256 public constant RING_SIZE = 32;
    IPoolManager public immutable poolManager;
    PoolRegistry public immutable registry;
    ProtocolFeeVault public feeVault;
    mapping(FXPoolId => PoolSnapshot[RING_SIZE]) private snapshots;
    mapping(FXPoolId => uint256) public snapshotCount;

    event PoolInitialized(FXPoolId indexed poolId, address indexed currency0, address indexed currency1);
    event FXBentoMarketSnapshot(
        FXPoolId indexed poolId, uint160 sqrtPriceX96, int24 tick, uint64 timestamp, uint256 volatility
    );
    event PreSwapContext(FXPoolId indexed poolId, address indexed sender);
    event ArcadeFeeVaultUpdated(address indexed feeVault);

    modifier onlyPoolManager() {
        require(msg.sender == address(poolManager), "NOT_POOL_MANAGER");
        _;
    }

    constructor(address owner_, IPoolManager poolManager_, PoolRegistry registry_, ProtocolFeeVault feeVault_)
        Pausable(owner_)
    {
        require(address(poolManager_) != address(0), "ZERO_POOL_MANAGER");
        poolManager = poolManager_;
        registry = registry_;
        feeVault = feeVault_;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function hookPermissionBitmap() external pure returns (uint160) {
        return Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    }

    function hookAddressHasPermissions(address hook) external pure returns (bool) {
        uint160 bitmap = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        uint160 allFlags = Hooks.ALL_HOOK_MASK;
        return uint160(hook) & allFlags == bitmap;
    }

    function setFeeVault(ProtocolFeeVault feeVault_) external onlyOwner {
        feeVault = feeVault_;
        emit ArcadeFeeVaultUpdated(address(feeVault_));
    }

    function validatePool(FXPoolKey calldata key) external view returns (bool) {
        return registry.isAllowed(FXPoolIdLibrary.toId(key));
    }

    function validateV4Pool(V4PoolKey calldata key) external view returns (bool) {
        return registry.isAllowed(_toFXPoolId(key));
    }

    function beforeInitialize(address, V4PoolKey calldata, uint160)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert("HOOK_NOT_ENABLED");
    }

    function afterInitialize(address, V4PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        FXPoolId poolId = _toFXPoolId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        _record(poolId, sqrtPriceX96, tick);
        emit PoolInitialized(poolId, Currency.unwrap(key.currency0), Currency.unwrap(key.currency1));
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address,
        V4PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4) {
        revert("HOOK_NOT_ENABLED");
    }

    function afterAddLiquidity(
        address,
        V4PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert("HOOK_NOT_ENABLED");
    }

    function beforeRemoveLiquidity(
        address,
        V4PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4) {
        revert("HOOK_NOT_ENABLED");
    }

    function afterRemoveLiquidity(
        address,
        V4PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert("HOOK_NOT_ENABLED");
    }

    function beforeSwap(address sender, V4PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        override
        onlyPoolManager
        whenNotPaused
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        FXPoolId poolId = _toFXPoolId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        emit PreSwapContext(poolId, sender);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(address, V4PoolKey calldata key, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        override
        onlyPoolManager
        whenNotPaused
        returns (bytes4, int128)
    {
        FXPoolId poolId = _toFXPoolId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        V4PoolId v4PoolId = key.toId();
        (uint160 sqrtPriceX96, int24 tick,,) = StateLibrary.getSlot0(poolManager, v4PoolId);
        _record(poolId, sqrtPriceX96, tick);
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeDonate(address, V4PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert("HOOK_NOT_ENABLED");
    }

    function afterDonate(address, V4PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert("HOOK_NOT_ENABLED");
    }

    function recordSnapshotForTesting(FXPoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external onlyOwner {
        FXPoolId poolId = FXPoolIdLibrary.toId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        _record(poolId, sqrtPriceX96, tick);
    }

    function latestSnapshot(FXPoolId poolId) public view returns (PoolSnapshot memory) {
        uint256 count = snapshotCount[poolId];
        require(count != 0, "NO_SNAPSHOT");
        return snapshots[poolId][(count - 1) % RING_SIZE];
    }

    function getPoolSnapshot(FXPoolId poolId) external view returns (PoolSnapshot memory) {
        return latestSnapshot(poolId);
    }

    function realizedVolatility(FXPoolId poolId, uint256 window) public view returns (uint256) {
        uint256 count = snapshotCount[poolId];
        if (count < 2) return 0;
        if (window > RING_SIZE || window > count - 1) window = count - 1;
        uint256 acc;
        PoolSnapshot memory prev = snapshots[poolId][(count - window - 1) % RING_SIZE];
        for (uint256 i; i < window; i++) {
            PoolSnapshot memory cur = snapshots[poolId][(count - window + i) % RING_SIZE];
            int256 delta = int256(cur.tick) - int256(prev.tick);
            acc += uint256(delta < 0 ? -delta : delta);
            prev = cur;
        }
        return acc / window;
    }

    function _record(FXPoolId poolId, uint160 sqrtPriceX96, int24 tick) internal {
        uint256 count = snapshotCount[poolId];
        uint256 vol = count == 0 ? 0 : realizedVolatility(poolId, count > 8 ? 8 : count);
        snapshots[poolId][count % RING_SIZE] = PoolSnapshot(sqrtPriceX96, tick, uint64(block.timestamp), vol);
        snapshotCount[poolId] = count + 1;
        emit FXBentoMarketSnapshot(poolId, sqrtPriceX96, tick, uint64(block.timestamp), vol);
    }

    function _toFXPoolId(V4PoolKey calldata key) internal pure returns (FXPoolId) {
        V4PoolId poolId = key.toId();
        return FXPoolId.wrap(V4PoolId.unwrap(poolId));
    }
}
