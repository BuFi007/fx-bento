// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

type PoolId is bytes32;

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct RoomConfig {
    PoolKey poolKey;
    address entryToken;
    uint256 entryFee;
    uint16 minPlayers;
    uint16 maxPlayers;
    uint16 rounds;
    uint32 roundDuration;
    uint32 lockBuffer;
    uint64 startTime;
    uint16 rakeBps;
    uint16[] payoutBps;
    bytes32 gridConfigHash;
    bool isPrivate;
    bytes32 inviteCodeHash;
}

struct RoomView {
    PoolId poolId;
    address entryToken;
    uint256 entryFee;
    uint16 minPlayers;
    uint16 maxPlayers;
    uint16 rounds;
    uint32 roundDuration;
    uint32 lockBuffer;
    uint64 startTime;
    uint16 rakeBps;
    bytes32 payoutHash;
    bytes32 gridConfigHash;
    bool isPrivate;
    bytes32 inviteCodeHash;
    uint8 status;
}

struct TileSelection {
    uint8[] rows;
    uint8[] cols;
    uint8 chipCount;
    bytes32 clientStateHash;
}

struct Round {
    uint256 roomId;
    uint16 roundIndex;
    uint64 startTime;
    uint64 endTime;
    uint64 lockTime;
    int256 anchorPrice;
    int256 settlementPrice;
    uint256 marketSnapshotId;
    bytes32 gridConfigHash;
    uint8 status;
}

library PoolIdLibrary {
    function toId(PoolKey memory key) internal pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks)));
    }
}
