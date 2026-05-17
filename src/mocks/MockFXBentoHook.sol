// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId, PoolKey, PoolIdLibrary} from "../libraries/FXBentoTypes.sol";

contract MockFXBentoHook {
    using PoolIdLibrary for PoolKey;

    struct PoolSnapshot {
        uint256 snapshotId;
        uint160 sqrtPriceX96;
        int24 tick;
        uint64 timestamp;
        uint256 volatility;
    }

    mapping(PoolId => PoolSnapshot) private snapshots;
    mapping(PoolId => uint256) public snapshotCount;

    function recordSnapshotForTesting(PoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external {
        PoolId poolId = key.toId();
        uint256 nextId = snapshotCount[poolId] + 1;
        snapshotCount[poolId] = nextId;
        snapshots[poolId] = PoolSnapshot({
            snapshotId: nextId,
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            timestamp: uint64(block.timestamp),
            volatility: 0
        });
    }

    function latestSnapshot(PoolId poolId) external view returns (PoolSnapshot memory) {
        PoolSnapshot memory snapshot = snapshots[poolId];
        require(snapshot.snapshotId != 0, "NO_SNAPSHOT");
        return snapshot;
    }
}
