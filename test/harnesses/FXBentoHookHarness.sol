// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FXBentoHook} from "../../src/FXBentoHook.sol";
import {
    PoolId as FXPoolId,
    PoolKey as FXPoolKey,
    PoolIdLibrary as FXPoolIdLibrary
} from "../../src/libraries/FXBentoTypes.sol";
import {PoolRegistry} from "../../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../../src/ProtocolFeeVault.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

contract FXBentoHookHarness is FXBentoHook {
    constructor(address owner_, IPoolManager poolManager_, PoolRegistry registry_, ProtocolFeeVault feeVault_)
        FXBentoHook(owner_, poolManager_, registry_, feeVault_)
    {}

    function recordSnapshotForTesting(FXPoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external onlyOwner {
        FXPoolId poolId = FXPoolIdLibrary.toId(key);
        require(registry.isAllowed(poolId), "POOL_NOT_ALLOWED");
        _record(poolId, sqrtPriceX96, tick);
    }
}
