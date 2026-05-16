// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {PoolId, PoolKey, PoolIdLibrary} from "./libraries/FXBentoTypes.sol";

contract PoolRegistry is AccessManaged {
    using PoolIdLibrary for PoolKey;

    struct PoolMetadata {
        PoolKey key;
        address baseToken;
        address quoteToken;
        address oracleSource;
        bool allowed;
        uint32 maxStaleSeconds;
        int24 tickSpacing;
        address hook;
    }

    mapping(PoolId => PoolMetadata) private pools;

    event PoolAllowed(
        PoolId indexed poolId, address indexed baseToken, address indexed quoteToken, address hook, bool allowed
    );

    constructor(address owner_) AccessManaged(owner_) {}

    function setPool(PoolKey calldata key, address oracleSource, bool allowed, uint32 maxStaleSeconds)
        external
        onlyOwner
    {
        PoolId poolId = PoolIdLibrary.toId(key);
        pools[poolId] = PoolMetadata({
            key: key,
            baseToken: key.currency0,
            quoteToken: key.currency1,
            oracleSource: oracleSource,
            allowed: allowed,
            maxStaleSeconds: maxStaleSeconds,
            tickSpacing: key.tickSpacing,
            hook: key.hooks
        });
        emit PoolAllowed(poolId, key.currency0, key.currency1, key.hooks, allowed);
    }

    function isAllowed(PoolId poolId) external view returns (bool) {
        return pools[poolId].allowed;
    }

    function isAllowedKey(PoolKey calldata key) external view returns (bool) {
        return pools[PoolIdLibrary.toId(key)].allowed;
    }

    function getPool(PoolId poolId) external view returns (PoolMetadata memory) {
        return pools[poolId];
    }
}
