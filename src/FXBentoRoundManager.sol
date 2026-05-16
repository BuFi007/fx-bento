// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {Round} from "./libraries/FXBentoTypes.sol";

contract FXBentoRoundManager is AccessManaged {
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    mapping(uint256 => mapping(uint16 => Round)) private rounds;

    event RoundStarted(
        uint256 indexed roomId, uint16 indexed roundIndex, uint64 startTime, uint64 lockTime, uint64 endTime
    );
    event AnchorRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price);
    event SettlementRecorded(uint256 indexed roomId, uint16 indexed roundIndex, int256 price);

    constructor(address owner_) AccessManaged(owner_) {}

    function startRound(
        uint256 roomId,
        uint16 roundIndex,
        uint64 startTime,
        uint64 endTime,
        uint64 lockTime,
        bytes32 gridConfigHash
    ) external onlyRole(COORDINATOR_ROLE) {
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
