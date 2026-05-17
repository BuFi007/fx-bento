// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged, ReentrancyGuard} from "./libraries/Guards.sol";
import {IERC20, SafeERC20} from "./libraries/MinimalTokens.sol";
import {MerkleProof} from "./libraries/MerkleProof.sol";
import {PayoutRoot, RoomView} from "./libraries/FXBentoTypes.sol";
import {FXBentoRoomFactory} from "./FXBentoRoomFactory.sol";
import {ProtocolFeeVault} from "./ProtocolFeeVault.sol";

contract FXBentoRoomEscrow is AccessManaged, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;

    FXBentoRoomFactory public immutable factory;
    ProtocolFeeVault public immutable protocolFeeVault;
    address public settlementManager;

    mapping(uint256 => address[]) private roomPlayers;
    mapping(uint256 => mapping(address => bool)) private seenPlayer;
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(uint256 => mapping(address => bool)) public refunded;
    mapping(uint256 => mapping(address => bool)) public prizeClaimed;
    mapping(uint256 => uint16) public activePlayerCount;
    mapping(uint256 => bytes32) public resultsRoot;
    mapping(uint256 => bytes32) public payoutSchemaHash;
    mapping(uint256 => bytes32) public rosterHash;
    mapping(uint256 => bytes32) public leaderboardHash;
    mapping(uint256 => bytes32) public scoreRoot;
    mapping(uint256 => bytes32) public settlementPriceRoot;
    mapping(uint256 => bytes32) public settlementMetadataHash;
    mapping(uint256 => uint256) public escrowed;
    mapping(uint256 => uint256) public protocolFee;
    mapping(uint256 => uint256) public payoutTotal;
    mapping(uint256 => uint256) public totalPrizeClaimed;
    mapping(uint256 => bool) public protocolFeeClaimed;

    event RoomJoined(uint256 indexed roomId, address indexed player);
    event RoomLeft(uint256 indexed roomId, address indexed player);
    event RoomCancelled(uint256 indexed roomId);
    event RoomLocked(uint256 indexed roomId, uint256 escrowed);
    event RoomSettled(
        uint256 indexed roomId,
        bytes32 indexed resultsRoot,
        bytes32 indexed payoutSchemaHash,
        uint256 payoutTotal,
        uint256 protocolFee
    );
    event Refunded(uint256 indexed roomId, address indexed player, uint256 amount);
    event PrizeClaimed(uint256 indexed roomId, address indexed player, uint256 amount);
    event ProtocolFeeClaimed(uint256 indexed roomId, uint256 amount);
    event SettlementManagerUpdated(address indexed settlementManager);

    constructor(address owner_, FXBentoRoomFactory factory_, ProtocolFeeVault protocolFeeVault_) AccessManaged(owner_) {
        factory = factory_;
        protocolFeeVault = protocolFeeVault_;
    }

    function setSettlementManager(address settlementManager_) external onlyOwner {
        require(settlementManager_ != address(0), "ZERO_SETTLEMENT_MANAGER");
        require(settlementManager == address(0), "SETTLEMENT_MANAGER_SET");
        settlementManager = settlementManager_;
        emit SettlementManagerUpdated(settlementManager_);
    }

    function joinRoom(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_NOT_LOBBY");
        require(!joined[roomId][msg.sender], "ALREADY_JOINED");
        require(activePlayerCount[roomId] < room.maxPlayers, "ROOM_FULL");
        joined[roomId][msg.sender] = true;
        refunded[roomId][msg.sender] = false;
        if (!seenPlayer[roomId][msg.sender]) {
            seenPlayer[roomId][msg.sender] = true;
            roomPlayers[roomId].push(msg.sender);
        }
        activePlayerCount[roomId] += 1;
        escrowed[roomId] += room.entryFee;
        IERC20(room.entryToken).safeTransferFrom(msg.sender, address(this), room.entryFee);
        emit RoomJoined(roomId, msg.sender);
    }

    function leaveRoom(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_STARTED");
        require(joined[roomId][msg.sender], "NOT_JOINED");
        joined[roomId][msg.sender] = false;
        activePlayerCount[roomId] -= 1;
        escrowed[roomId] -= room.entryFee;
        IERC20(room.entryToken).safeTransfer(msg.sender, room.entryFee);
        emit RoomLeft(roomId, msg.sender);
    }

    function cancelRoom(uint256 roomId) external {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_NOT_LOBBY");
        require(block.timestamp >= room.startTime, "START_PENDING");
        require(activePlayerCount[roomId] < room.minPlayers, "CANNOT_CANCEL");
        factory.transitionRoomStatus(roomId, 0, 4);
        emit RoomCancelled(roomId);
    }

    function cancelLockedRoom(uint256 roomId) external {
        require(msg.sender == settlementManager, "NOT_SETTLEMENT_MANAGER");
        require(resultsRoot[roomId] == bytes32(0), "ALREADY_SETTLED");
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1 || room.status == 2, "ROOM_NOT_RESCUABLE");
        factory.transitionRoomStatus(roomId, room.status, 4);
        emit RoomCancelled(roomId);
    }

    function refund(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 4, "ROOM_NOT_CANCELLED");
        require(joined[roomId][msg.sender] && !refunded[roomId][msg.sender], "NO_REFUND");
        refunded[roomId][msg.sender] = true;
        joined[roomId][msg.sender] = false;
        activePlayerCount[roomId] -= 1;
        escrowed[roomId] -= room.entryFee;
        IERC20(room.entryToken).safeTransfer(msg.sender, room.entryFee);
        emit Refunded(roomId, msg.sender, room.entryFee);
    }

    function lockRoom(uint256 roomId) external {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_NOT_LOBBY");
        require(block.timestamp >= room.startTime, "START_PENDING");
        require(activePlayerCount[roomId] >= room.minPlayers, "BELOW_MIN_PLAYERS");
        factory.transitionRoomStatus(roomId, 0, 1);
        emit RoomLocked(roomId, escrowed[roomId]);
    }

    function markSettling(uint256 roomId) external {
        require(msg.sender == settlementManager, "NOT_SETTLEMENT_MANAGER");
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1, "ROOM_NOT_LOCKED");
        factory.transitionRoomStatus(roomId, 1, 2);
    }

    function settleRoom(uint256 roomId, PayoutRoot calldata payout, bytes calldata) public {
        require(msg.sender == settlementManager, "NOT_SETTLEMENT_MANAGER");
        require(resultsRoot[roomId] == bytes32(0), "ALREADY_SETTLED");
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1 || room.status == 2, "ROOM_NOT_SETTLING");
        require(payout.roomId == roomId, "ROOM_MISMATCH");
        require(payout.winnerRoot != bytes32(0), "ZERO_ROOT");
        require(payout.rosterHash != bytes32(0), "ZERO_ROSTER");
        require(payout.leaderboardHash != bytes32(0), "ZERO_LEADERBOARD");
        require(payout.scoreRoot != bytes32(0), "ZERO_SCORE_ROOT");
        require(payout.settlementPriceRoot != bytes32(0), "ZERO_PRICE_ROOT");
        uint256 expectedFee = escrowed[roomId] * room.rakeBps / BPS;
        require(payout.protocolFee == expectedFee, "BAD_PROTOCOL_FEE");
        require(payout.payoutTotal + payout.protocolFee <= escrowed[roomId], "PAYOUT_EXCEEDS_ESCROW");
        protocolFee[roomId] = payout.protocolFee;
        payoutTotal[roomId] = payout.payoutTotal;
        resultsRoot[roomId] = payout.winnerRoot;
        rosterHash[roomId] = payout.rosterHash;
        leaderboardHash[roomId] = payout.leaderboardHash;
        scoreRoot[roomId] = payout.scoreRoot;
        settlementPriceRoot[roomId] = payout.settlementPriceRoot;
        settlementMetadataHash[roomId] = payout.metadataHash;
        payoutSchemaHash[roomId] = hashPayoutRoot(payout);
        factory.transitionRoomStatus(roomId, room.status, 3);
        emit RoomSettled(roomId, payout.winnerRoot, payoutSchemaHash[roomId], payout.payoutTotal, payout.protocolFee);
    }

    function claimPrize(uint256 roomId, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 3, "ROOM_NOT_SETTLED");
        require(isActivePlayer(roomId, msg.sender), "NOT_PLAYER");
        require(!prizeClaimed[roomId][msg.sender], "PRIZE_CLAIMED");
        bytes32 leaf = keccak256(abi.encode(roomId, msg.sender, amount));
        require(MerkleProof.verify(proof, resultsRoot[roomId], leaf), "BAD_PROOF");
        require(totalPrizeClaimed[roomId] + amount <= payoutTotal[roomId], "PRIZE_EXCEEDS_TOTAL");
        require(totalPrizeClaimed[roomId] + amount + protocolFee[roomId] <= escrowed[roomId], "PAYOUT_EXCEEDS_ESCROW");
        prizeClaimed[roomId][msg.sender] = true;
        totalPrizeClaimed[roomId] += amount;
        IERC20(room.entryToken).safeTransfer(msg.sender, amount);
        emit PrizeClaimed(roomId, msg.sender, amount);
    }

    function claimProtocolFee(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 3, "ROOM_NOT_SETTLED");
        require(!protocolFeeClaimed[roomId], "FEE_CLAIMED");
        require(totalPrizeClaimed[roomId] + protocolFee[roomId] <= escrowed[roomId], "PAYOUT_EXCEEDS_ESCROW");
        protocolFeeClaimed[roomId] = true;
        IERC20(room.entryToken).safeTransfer(address(protocolFeeVault), protocolFee[roomId]);
        protocolFeeVault.notifyFee(room.entryToken, roomId, protocolFee[roomId]);
        emit ProtocolFeeClaimed(roomId, protocolFee[roomId]);
    }

    function players(uint256 roomId) external view returns (address[] memory) {
        return roomPlayers[roomId];
    }

    function isActivePlayer(uint256 roomId, address player) public view returns (bool) {
        if (!joined[roomId][player] || refunded[roomId][player]) return false;
        uint8 status = factory.getRoom(roomId).status;
        return status == 1 || status == 2 || status == 3;
    }

    function canPlay(uint256 roomId, address player) public view returns (bool) {
        if (!joined[roomId][player] || refunded[roomId][player]) return false;
        uint8 status = factory.getRoom(roomId).status;
        return status == 1 || status == 2;
    }

    function hashPayoutRoot(PayoutRoot memory payout) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                payout.roomId,
                payout.winnerRoot,
                payout.rosterHash,
                payout.leaderboardHash,
                payout.scoreRoot,
                payout.settlementPriceRoot,
                payout.payoutTotal,
                payout.protocolFee,
                payout.metadataHash
            )
        );
    }
}
