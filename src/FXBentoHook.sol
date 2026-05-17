// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "./libraries/Guards.sol";
import {PoolId, PoolKey, PoolIdLibrary} from "./libraries/FXBentoTypes.sol";
import {PoolRegistry} from "./PoolRegistry.sol";
import {ProtocolFeeVault} from "./ProtocolFeeVault.sol";

contract FXBentoHook is Pausable {
    using PoolIdLibrary for PoolKey;

    struct HookPermissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
        bool beforeSwapReturnDelta;
        bool afterSwapReturnDelta;
        bool afterAddLiquidityReturnDelta;
        bool afterRemoveLiquidityReturnDelta;
    }

    struct PoolSnapshot {
        uint160 sqrtPriceX96;
        int24 tick;
        uint64 timestamp;
        uint256 volatility;
    }

    uint256 public constant RING_SIZE = 32;
    address public immutable poolManager;
    PoolRegistry public immutable registry;
    ProtocolFeeVault public feeVault;
    mapping(PoolId => PoolSnapshot[RING_SIZE]) private snapshots;
    mapping(PoolId => uint256) public snapshotCount;

    event PoolInitialized(PoolId indexed poolId, address indexed currency0, address indexed currency1);
    event FXBentoMarketSnapshot(
        PoolId indexed poolId, uint160 sqrtPriceX96, int24 tick, uint64 timestamp, uint256 volatility
    );
    event PreSwapContext(PoolId indexed poolId, address indexed sender);
    event ArcadeFeeVaultUpdated(address indexed feeVault);

    modifier onlyPoolManager() {
        require(msg.sender == poolManager, "NOT_POOL_MANAGER");
        _;
    }

    constructor(address owner_, address poolManager_, PoolRegistry registry_, ProtocolFeeVault feeVault_)
        Pausable(owner_)
    {
        require(poolManager_ != address(0), "ZERO_POOL_MANAGER");
        poolManager = poolManager_;
        registry = registry_;
        feeVault = feeVault_;
    }

    function getHookPermissions() external pure returns (HookPermissions memory) {
        return HookPermissions({
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

    function setFeeVault(ProtocolFeeVault feeVault_) external onlyOwner {
        feeVault = feeVault_;
        emit ArcadeFeeVaultUpdated(address(feeVault_));
    }

    function validatePool(PoolKey calldata key) external view returns (bool) {
        return registry.isAllowed(PoolIdLibrary.toId(key));
    }

    function afterInitialize(PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external
        onlyPoolManager
        returns (bytes4)
    {
        PoolId poolId = PoolIdLibrary.toId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        _record(poolId, sqrtPriceX96, tick);
        emit PoolInitialized(poolId, key.currency0, key.currency1);
        return this.afterInitialize.selector;
    }

    function beforeSwap(PoolKey calldata key, address sender) external onlyPoolManager whenNotPaused returns (bytes4) {
        PoolId poolId = PoolIdLibrary.toId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        emit PreSwapContext(poolId, sender);
        return this.beforeSwap.selector;
    }

    function afterSwap(PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external
        onlyPoolManager
        whenNotPaused
        returns (bytes4)
    {
        PoolId poolId = PoolIdLibrary.toId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        _record(poolId, sqrtPriceX96, tick);
        return this.afterSwap.selector;
    }

    function recordSnapshotForTesting(PoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external onlyOwner {
        PoolId poolId = PoolIdLibrary.toId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        _record(poolId, sqrtPriceX96, tick);
    }

    function latestSnapshot(PoolId poolId) public view returns (PoolSnapshot memory) {
        uint256 count = snapshotCount[poolId];
        require(count != 0, "NO_SNAPSHOT");
        return snapshots[poolId][(count - 1) % RING_SIZE];
    }

    function getPoolSnapshot(PoolId poolId) external view returns (PoolSnapshot memory) {
        return latestSnapshot(poolId);
    }

    function realizedVolatility(PoolId poolId, uint256 window) public view returns (uint256) {
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

    function _record(PoolId poolId, uint160 sqrtPriceX96, int24 tick) internal {
        uint256 count = snapshotCount[poolId];
        uint256 vol = count == 0 ? 0 : realizedVolatility(poolId, count > 8 ? 8 : count);
        snapshots[poolId][count % RING_SIZE] = PoolSnapshot(sqrtPriceX96, tick, uint64(block.timestamp), vol);
        snapshotCount[poolId] = count + 1;
        emit FXBentoMarketSnapshot(poolId, sqrtPriceX96, tick, uint64(block.timestamp), vol);
    }
}
