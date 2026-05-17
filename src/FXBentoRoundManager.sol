// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {Round, RoomView} from "./libraries/FXBentoTypes.sol";
import {FXBentoRoomFactory} from "./FXBentoRoomFactory.sol";

contract FXBentoRoundManager is AccessManaged {
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    FXBentoRoomFactory public immutable factory;
    mapping(uint256 => mapping(uint16 => Round)) private rounds;

    event RoundStarted(
        uint256 indexed roomId, uint16 indexed roundIndex, uint64 startTime, uint64 lockTime, uint64 endTime
    );
    event AnchorRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price);
    event SettlementRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price);

    constructor(address owner_, FXBentoRoomFactory factory_) AccessManaged(owner_) {
        factory = factory_;
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
        rounds[roomId][roundIndex] = Round(roomId, roundIndex, startTime, endTime, lockTime, 0, 0, 0, gridConfigHash, 1);
        emit RoundStarted(roomId, roundIndex, startTime, lockTime, endTime);
    }

    function recordAnchor(uint256 roomId, uint16 roundIndex, int256 price) external onlyRole(COORDINATOR_ROLE) {
        Round storage round = rounds[roomId][roundIndex];
        require(round.status == 1, "ROUND_NOT_ACTIVE");
        round.anchorPrice = price;
        emit AnchorRecorded(roomId, roundIndex, price);
    }

    function recordSettlement(uint256 roomId, uint16 roundIndex, int256 price) external onlyRole(COORDINATOR_ROLE) {
        Round storage round = rounds[roomId][roundIndex];
        require(round.status == 1, "ROUND_NOT_ACTIVE");
        round.settlementPrice = price;
        round.status = 2;
        emit SettlementRecorded(roomId, roundIndex, price);
    }

    function getRound(uint256 roomId, uint16 roundIndex) external view returns (Round memory) {
        return rounds[roomId][roundIndex];
    }
}
