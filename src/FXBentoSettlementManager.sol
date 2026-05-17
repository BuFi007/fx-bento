// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {FXBentoRoomEscrow} from "./FXBentoRoomEscrow.sol";
import {FXBentoRoomFactory} from "./FXBentoRoomFactory.sol";
import {FXBentoRoundManager} from "./FXBentoRoundManager.sol";

contract FXBentoSettlementManager is AccessManaged {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    struct PendingResults {
        bytes32 resultsRoot;
        string metadataURI;
        bytes attestation;
        uint64 submittedAt;
        bool challenged;
        bool finalized;
        bool resolved;
    }

    uint64 public challengeWindow = 10 minutes;
    FXBentoRoomFactory public immutable factory;
    FXBentoRoomEscrow public immutable escrow;
    FXBentoRoundManager public roundManager;
    mapping(uint256 => PendingResults) public pendingResults;

    event ResultsSubmitted(uint256 indexed roomId, bytes32 indexed resultsRoot, string metadataURI);
    event ResultsChallenged(uint256 indexed roomId, bytes proof);
    event ChallengeResolved(uint256 indexed roomId, bool accepted);
    event ResultsFinalized(uint256 indexed roomId, bytes32 indexed resultsRoot);

    constructor(address owner_, FXBentoRoomFactory factory_, FXBentoRoomEscrow escrow_) AccessManaged(owner_) {
        factory = factory_;
        escrow = escrow_;
    }

    function setChallengeWindow(uint64 challengeWindow_) external onlyOwner {
        require(challengeWindow_ <= 2 days, "WINDOW_TOO_LONG");
        challengeWindow = challengeWindow_;
    }

    function setRoundManager(FXBentoRoundManager roundManager_) external onlyOwner {
        roundManager = roundManager_;
    }

    function submitResults(uint256 roomId, bytes32 resultsRoot, string calldata metadataURI, bytes calldata attestation)
        external
        onlyRole(ATTESTOR_ROLE)
    {
        require(factory.getRoom(roomId).status == 1 || factory.getRoom(roomId).status == 2, "ROOM_NOT_ACTIVE");
        require(address(roundManager) != address(0), "ROUND_MANAGER_NOT_SET");
        require(roundManager.allRoundsEnded(roomId), "ROUNDS_NOT_ENDED");
        require(pendingResults[roomId].submittedAt == 0, "ALREADY_SUBMITTED");
        require(resultsRoot != bytes32(0), "ZERO_ROOT");
        pendingResults[roomId] =
            PendingResults(resultsRoot, metadataURI, attestation, uint64(block.timestamp), false, false, false);
        emit ResultsSubmitted(roomId, resultsRoot, metadataURI);
    }

    function challengeResults(uint256 roomId, bytes calldata proof) external {
        PendingResults storage pending = pendingResults[roomId];
        require(pending.submittedAt != 0, "NO_RESULTS");
        require(block.timestamp <= pending.submittedAt + challengeWindow, "CHALLENGE_CLOSED");
        pending.challenged = true;
        emit ResultsChallenged(roomId, proof);
    }

    function resolveChallenge(uint256 roomId, bool accepted, bytes32 replacementRoot, string calldata metadataURI)
        external
        onlyOwner
    {
        PendingResults storage pending = pendingResults[roomId];
        require(pending.submittedAt != 0, "NO_RESULTS");
        require(pending.challenged, "NOT_CHALLENGED");
        require(!pending.finalized, "FINALIZED");
        if (accepted) {
            require(replacementRoot != bytes32(0), "ZERO_ROOT");
            pending.resultsRoot = replacementRoot;
            pending.metadataURI = metadataURI;
            pending.submittedAt = uint64(block.timestamp);
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
        escrow.settleRoom(roomId, pending.resultsRoot, pending.attestation);
        emit ResultsFinalized(roomId, pending.resultsRoot);
    }
}
