// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {PoolRegistry} from "./PoolRegistry.sol";
import {FXBentoHook} from "./FXBentoHook.sol";
import {PoolId, Round, RoomView} from "./libraries/FXBentoTypes.sol";
import {FXBentoRoomFactory} from "./FXBentoRoomFactory.sol";

contract FXBentoRoundManager is AccessManaged {
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    FXBentoRoomFactory public immutable factory;
    FXBentoHook public immutable hook;
    mapping(uint256 => mapping(uint16 => Round)) private rounds;

    event RoundStarted(
        uint256 indexed roomId,
        uint16 indexed roundIndex,
        uint64 startTime,
        uint64 lockTime,
        uint64 endTime,
        uint256 anchorSnapshotId
    );
    event AnchorRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price, uint256 snapshotId);
    event SettlementRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price, uint256 snapshotId);

    constructor(address owner_, FXBentoRoomFactory factory_, FXBentoHook hook_) AccessManaged(owner_) {
        factory = factory_;
        hook = hook_;
    }

    function startRound(
        uint256 roomId,
        uint16 roundIndex,
        uint64 startTime,
        uint64 endTime,
        uint64 lockTime,
        bytes32 gridConfigHash
    ) external onlyRole(COORDINATOR_ROLE) {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1 || room.status == 2, "ROOM_NOT_ACTIVE");
        require(roundIndex < room.rounds, "ROUND_INDEX");
        require(gridConfigHash == room.gridConfigHash, "GRID_MISMATCH");
        require(startTime >= room.startTime, "ROUND_TOO_EARLY");
        require(lockTime > startTime && endTime > lockTime, "BAD_ROUND_TIME");
        require(endTime - startTime == room.roundDuration, "BAD_DURATION");
        require(endTime - lockTime == room.lockBuffer, "BAD_LOCK_BUFFER");
        require(rounds[roomId][roundIndex].status == 0, "ROUND_EXISTS");

        FXBentoHook.PoolSnapshot memory snapshot = _freshSnapshot(room.poolId);
        int256 anchorPrice = int256(uint256(snapshot.sqrtPriceX96));
        rounds[roomId][roundIndex] = Round({
            roomId: roomId,
            roundIndex: roundIndex,
            poolId: room.poolId,
            startTime: startTime,
            endTime: endTime,
            lockTime: lockTime,
            anchorPrice: anchorPrice,
            settlementPrice: 0,
            anchorSnapshotId: snapshot.snapshotId,
            settlementSnapshotId: 0,
            gridConfigHash: gridConfigHash,
            status: 1
        });
        emit RoundStarted(roomId, roundIndex, startTime, lockTime, endTime, snapshot.snapshotId);
        emit AnchorRecorded(roomId, roundIndex, anchorPrice, snapshot.snapshotId);
    }

    function recordAnchor(uint256 roomId, uint16 roundIndex, int256 price) external onlyRole(COORDINATOR_ROLE) {
        Round storage round = rounds[roomId][roundIndex];
        require(round.status == 1, "ROUND_NOT_ACTIVE");
        require(round.anchorSnapshotId == 0, "ANCHOR_LOCKED");
        round.anchorPrice = price;
        emit AnchorRecorded(roomId, roundIndex, price, round.anchorSnapshotId);
    }

    function recordSettlement(uint256 roomId, uint16 roundIndex) external onlyRole(COORDINATOR_ROLE) {
        Round storage round = rounds[roomId][roundIndex];
        require(round.status == 1, "ROUND_NOT_ACTIVE");
        require(block.timestamp >= round.endTime, "ROUND_NOT_ENDED");
        FXBentoHook.PoolSnapshot memory snapshot = _freshSnapshot(round.poolId);
        require(snapshot.snapshotId > round.anchorSnapshotId, "NO_SETTLEMENT_SNAPSHOT");
        int256 price = int256(uint256(snapshot.sqrtPriceX96));
        round.settlementPrice = price;
        round.settlementSnapshotId = snapshot.snapshotId;
        round.status = 2;
        emit SettlementRecorded(roomId, roundIndex, price, snapshot.snapshotId);
    }

    function getRound(uint256 roomId, uint16 roundIndex) external view returns (Round memory) {
        return rounds[roomId][roundIndex];
    }

    function allRoundsEnded(uint256 roomId) external view returns (bool) {
        RoomView memory room = factory.getRoom(roomId);
        for (uint16 i; i < room.rounds; i++) {
            Round memory round = rounds[roomId][i];
            if (round.status != 2 || round.settlementSnapshotId == 0) return false;
        }
        return true;
    }

    function _freshSnapshot(PoolId poolId) internal view returns (FXBentoHook.PoolSnapshot memory snapshot) {
        snapshot = hook.latestSnapshot(poolId);
        PoolRegistry.PoolMetadata memory metadata = factory.poolRegistry().getPool(poolId);
        require(metadata.allowed, "POOL_NOT_ALLOWED");
        require(block.timestamp <= snapshot.timestamp + metadata.maxStaleSeconds, "STALE_SNAPSHOT");
    }
}
