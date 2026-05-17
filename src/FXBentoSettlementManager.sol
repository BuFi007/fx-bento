// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {FXBentoRoomEscrow} from "./FXBentoRoomEscrow.sol";
import {FXBentoRoomFactory} from "./FXBentoRoomFactory.sol";
import {FXBentoRoundManager} from "./FXBentoRoundManager.sol";
import {PayoutRoot, RoomView} from "./libraries/FXBentoTypes.sol";

contract FXBentoSettlementManager is AccessManaged {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    uint8 public constant CHALLENGE_NONE = 0;
    uint8 public constant CHALLENGE_OPEN = 1;
    uint8 public constant CHALLENGE_ACCEPTED = 2;
    uint8 public constant CHALLENGE_REJECTED = 3;

    struct PendingResults {
        PayoutRoot payout;
        bytes32 payoutSchemaHash;
        string metadataURI;
        bytes attestation;
        uint64 submittedAt;
        uint64 challengedAt;
        uint8 challengeStatus;
        bool challenged;
        bool finalized;
        bool resolved;
    }

    uint64 public challengeWindow = 10 minutes;
    uint64 public settlementRescueDelay = 1 days;
    FXBentoRoomFactory public immutable factory;
    FXBentoRoomEscrow public immutable escrow;
    FXBentoRoundManager public roundManager;
    mapping(uint256 => PendingResults) public pendingResults;

    event ResultsSubmitted(uint256 indexed roomId, bytes32 indexed resultsRoot, string metadataURI);
    event ResultsChallenged(uint256 indexed roomId, bytes proof);
    event ChallengeResolved(uint256 indexed roomId, bool accepted);
    event ResultsFinalized(uint256 indexed roomId, bytes32 indexed resultsRoot);
    event SettlementRescueDelayUpdated(uint64 settlementRescueDelay);
    event SettlementRescued(uint256 indexed roomId);

    constructor(address owner_, FXBentoRoomFactory factory_, FXBentoRoomEscrow escrow_) AccessManaged(owner_) {
        factory = factory_;
        escrow = escrow_;
    }

    function setChallengeWindow(uint64 challengeWindow_) external onlyOwner {
        require(challengeWindow_ <= 2 days, "WINDOW_TOO_LONG");
        challengeWindow = challengeWindow_;
    }

    function setSettlementRescueDelay(uint64 settlementRescueDelay_) external onlyOwner {
        require(settlementRescueDelay_ <= 30 days, "RESCUE_DELAY_TOO_LONG");
        settlementRescueDelay = settlementRescueDelay_;
        emit SettlementRescueDelayUpdated(settlementRescueDelay_);
    }

    function setRoundManager(FXBentoRoundManager roundManager_) external onlyOwner {
        roundManager = roundManager_;
    }

    function submitResults(
        uint256 roomId,
        PayoutRoot calldata payout,
        string calldata metadataURI,
        bytes calldata attestation
    ) external onlyRole(ATTESTOR_ROLE) {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1 || room.status == 2, "ROOM_NOT_ACTIVE");
        require(address(roundManager) != address(0), "ROUND_MANAGER_NOT_SET");
        require(roundManager.allRoundsEnded(roomId), "ROUNDS_NOT_ENDED");
        require(pendingResults[roomId].submittedAt == 0, "ALREADY_SUBMITTED");
        if (room.status == 1) escrow.markSettling(roomId);
        _validatePayout(roomId, room, payout, metadataURI);
        bytes32 payoutSchemaHash = escrow.hashPayoutRoot(payout);
        pendingResults[roomId] = PendingResults({
            payout: payout,
            payoutSchemaHash: payoutSchemaHash,
            metadataURI: metadataURI,
            attestation: attestation,
            submittedAt: uint64(block.timestamp),
            challengedAt: 0,
            challengeStatus: CHALLENGE_NONE,
            challenged: false,
            finalized: false,
            resolved: false
        });
        emit ResultsSubmitted(roomId, payout.winnerRoot, metadataURI);
    }

    function challengeResults(uint256 roomId, bytes calldata proof) external {
        PendingResults storage pending = pendingResults[roomId];
        require(pending.submittedAt != 0, "NO_RESULTS");
        require(!pending.finalized, "FINALIZED");
        require(!pending.challenged, "ALREADY_CHALLENGED");
        require(proof.length != 0, "EMPTY_PROOF");
        require(block.timestamp <= pending.submittedAt + challengeWindow, "CHALLENGE_CLOSED");
        pending.challenged = true;
        pending.challengedAt = uint64(block.timestamp);
        pending.challengeStatus = CHALLENGE_OPEN;
        emit ResultsChallenged(roomId, proof);
    }

    function resolveChallenge(
        uint256 roomId,
        bool accepted,
        PayoutRoot calldata replacement,
        string calldata metadataURI
    ) external onlyOwner {
        PendingResults storage pending = pendingResults[roomId];
        require(pending.submittedAt != 0, "NO_RESULTS");
        require(pending.challenged, "NOT_CHALLENGED");
        require(!pending.finalized, "FINALIZED");
        require(block.timestamp <= pending.challengedAt + settlementRescueDelay, "CHALLENGE_EXPIRED");
        if (accepted) {
            RoomView memory room = factory.getRoom(roomId);
            _validatePayout(roomId, room, replacement, metadataURI);
            pending.payout = replacement;
            pending.payoutSchemaHash = escrow.hashPayoutRoot(replacement);
            pending.metadataURI = metadataURI;
            pending.submittedAt = uint64(block.timestamp);
            pending.challengeStatus = CHALLENGE_ACCEPTED;
        } else {
            pending.challengeStatus = CHALLENGE_REJECTED;
        }
        pending.challenged = false;
        pending.resolved = true;
        emit ChallengeResolved(roomId, accepted);
    }

    function finalizeResults(uint256 roomId) external {
        PendingResults storage pending = pendingResults[roomId];
        require(pending.submittedAt != 0, "NO_RESULTS");
        require(!pending.challenged, "CHALLENGED");
        require(block.timestamp >= pending.submittedAt + challengeWindow, "CHALLENGE_OPEN");
        require(!pending.finalized, "FINALIZED");
        pending.finalized = true;
        escrow.settleRoom(roomId, pending.payout, pending.attestation);
        emit ResultsFinalized(roomId, pending.payout.winnerRoot);
    }

    function rescueFailedSettlement(uint256 roomId) external {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1 || room.status == 2, "ROOM_NOT_RESCUABLE");
        require(block.timestamp >= settlementRescueDeadline(roomId), "RESCUE_PENDING");
        PendingResults storage pending = pendingResults[roomId];
        require(!pending.finalized, "FINALIZED");
        escrow.cancelLockedRoom(roomId);
        emit SettlementRescued(roomId);
    }

    function challengeDeadline(uint256 roomId) public view returns (uint256) {
        PendingResults storage pending = pendingResults[roomId];
        require(pending.submittedAt != 0, "NO_RESULTS");
        return pending.submittedAt + challengeWindow;
    }

    function settlementRescueDeadline(uint256 roomId) public view returns (uint256) {
        RoomView memory room = factory.getRoom(roomId);
        PendingResults storage pending = pendingResults[roomId];
        if (pending.submittedAt == 0) return _roomEndTime(room) + settlementRescueDelay;
        uint256 deadline = pending.submittedAt + challengeWindow + settlementRescueDelay;
        if (pending.challenged) {
            uint256 challengedDeadline = pending.challengedAt + settlementRescueDelay;
            if (challengedDeadline > deadline) return challengedDeadline;
        }
        return deadline;
    }

    function _validatePayout(
        uint256 roomId,
        RoomView memory room,
        PayoutRoot calldata payout,
        string calldata metadataURI
    ) internal view {
        require(payout.roomId == roomId, "ROOM_MISMATCH");
        require(payout.winnerRoot != bytes32(0), "ZERO_ROOT");
        require(payout.rosterHash != bytes32(0), "ZERO_ROSTER");
        require(payout.leaderboardHash != bytes32(0), "ZERO_LEADERBOARD");
        require(payout.scoreRoot != bytes32(0), "ZERO_SCORE_ROOT");
        require(payout.settlementPriceRoot != bytes32(0), "ZERO_PRICE_ROOT");
        require(payout.metadataHash == keccak256(bytes(metadataURI)), "METADATA_MISMATCH");
        uint256 escrowed = escrow.escrowed(roomId);
        require(payout.protocolFee == escrowed * room.rakeBps / escrow.BPS(), "BAD_PROTOCOL_FEE");
        require(payout.payoutTotal + payout.protocolFee <= escrowed, "PAYOUT_EXCEEDS_ESCROW");
    }

    function _roomEndTime(RoomView memory room) internal pure returns (uint256) {
        return uint256(room.startTime) + uint256(room.rounds) * uint256(room.roundDuration);
    }
}
