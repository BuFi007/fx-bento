// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged, Pausable} from "./libraries/Guards.sol";
import {PoolId, PoolKey, RoomConfig, RoomView, PoolIdLibrary} from "./libraries/FXBentoTypes.sol";
import {PoolRegistry} from "./PoolRegistry.sol";

contract FXBentoRoomFactory is Pausable {
    using PoolIdLibrary for PoolKey;

    uint16 public constant BPS = 10_000;
    uint8 public constant STATUS_LOBBY = 0;
    uint8 public constant STATUS_LOCKED = 1;
    uint8 public constant STATUS_SETTLING = 2;
    uint8 public constant STATUS_SETTLED = 3;
    uint8 public constant STATUS_CANCELLED = 4;
    uint16 public maxRakeBps = 1_000;
    uint16 public protocolMaxPlayers = 20;
    uint256 public nextRoomId = 1;
    address public escrow;

    PoolRegistry public immutable poolRegistry;
    mapping(address => bool) public allowedEntryToken;
    mapping(uint256 => RoomView) private rooms;
    mapping(uint256 => uint16[]) private payouts;

    event RoomCreated(uint256 indexed roomId, PoolId indexed poolId, address indexed entryToken, uint256 entryFee);
    event RoomStatusUpdated(uint256 indexed roomId, uint8 status);
    event EntryTokenAllowed(address indexed token, bool allowed);
    event LimitsUpdated(uint16 maxRakeBps, uint16 protocolMaxPlayers);
    event EscrowUpdated(address indexed escrow);

    constructor(address owner_, PoolRegistry poolRegistry_) Pausable(owner_) {
        poolRegistry = poolRegistry_;
    }

    function setEscrow(address escrow_) external onlyOwner {
        escrow = escrow_;
        emit EscrowUpdated(escrow_);
    }

    function setEntryToken(address token, bool allowed) external onlyOwner {
        allowedEntryToken[token] = allowed;
        emit EntryTokenAllowed(token, allowed);
    }

    function setLimits(uint16 maxRakeBps_, uint16 protocolMaxPlayers_) external onlyOwner {
        require(maxRakeBps_ <= 2_000, "RAKE_TOO_HIGH");
        require(protocolMaxPlayers_ >= 2, "MAX_PLAYERS_LOW");
        maxRakeBps = maxRakeBps_;
        protocolMaxPlayers = protocolMaxPlayers_;
        emit LimitsUpdated(maxRakeBps_, protocolMaxPlayers_);
    }

    function createRoom(RoomConfig calldata config) external whenNotPaused returns (uint256 roomId) {
        require(allowedEntryToken[config.entryToken], "ENTRY_TOKEN_NOT_ALLOWED");
        require(config.rakeBps <= maxRakeBps, "RAKE_TOO_HIGH");
        require(config.maxPlayers <= protocolMaxPlayers, "MAX_PLAYERS_TOO_HIGH");
        require(config.minPlayers >= 2 && config.minPlayers <= config.maxPlayers, "BAD_PLAYER_LIMITS");
        require(config.rounds > 0, "NO_ROUNDS");
        require(config.roundDuration > 0, "NO_ROUND_DURATION");
        require(config.lockBuffer < config.roundDuration, "BAD_LOCK_BUFFER");
        require(config.startTime > block.timestamp, "START_NOT_FUTURE");
        require(config.entryFee > 0, "NO_ENTRY_FEE");
        require(_sum(config.payoutBps) == BPS, "BAD_PAYOUT_SPLIT");
        PoolId poolId = PoolIdLibrary.toId(config.poolKey);
        require(poolRegistry.isAllowed(poolId), "POOL_NOT_ALLOWED");

        roomId = nextRoomId++;
        payouts[roomId] = config.payoutBps;
        rooms[roomId] = RoomView({
            poolId: poolId,
            entryToken: config.entryToken,
            entryFee: config.entryFee,
            minPlayers: config.minPlayers,
            maxPlayers: config.maxPlayers,
            rounds: config.rounds,
            roundDuration: config.roundDuration,
            lockBuffer: config.lockBuffer,
            startTime: config.startTime,
            rakeBps: config.rakeBps,
            payoutHash: keccak256(abi.encode(config.payoutBps)),
            gridConfigHash: config.gridConfigHash,
            isPrivate: config.isPrivate,
            inviteCodeHash: config.inviteCodeHash,
            status: STATUS_LOBBY
        });
        emit RoomCreated(roomId, poolId, config.entryToken, config.entryFee);
    }

    function transitionRoomStatus(uint256 roomId, uint8 expectedStatus, uint8 nextStatus) external {
        require(msg.sender == escrow, "NOT_ESCROW");
        require(rooms[roomId].entryToken != address(0), "ROOM_NOT_FOUND");
        require(rooms[roomId].status == expectedStatus, "BAD_ROOM_STATUS");
        require(_allowedTransition(expectedStatus, nextStatus), "BAD_TRANSITION");
        rooms[roomId].status = nextStatus;
        emit RoomStatusUpdated(roomId, nextStatus);
    }

    function roomExists(uint256 roomId) external view returns (bool) {
        return rooms[roomId].entryToken != address(0);
    }

    function getRoom(uint256 roomId) external view returns (RoomView memory) {
        RoomView memory room = rooms[roomId];
        require(room.entryToken != address(0), "ROOM_NOT_FOUND");
        return room;
    }

    function getPayoutBps(uint256 roomId) external view returns (uint16[] memory) {
        return payouts[roomId];
    }

    function _sum(uint16[] calldata values) internal pure returns (uint256 total) {
        for (uint256 i; i < values.length; i++) {
            total += values[i];
        }
    }

    function _allowedTransition(uint8 from, uint8 to) internal pure returns (bool) {
        if (from == STATUS_LOBBY) {
            return to == STATUS_LOCKED || to == STATUS_CANCELLED;
        }
        if (from == STATUS_LOCKED) {
            return to == STATUS_SETTLING || to == STATUS_SETTLED || to == STATUS_CANCELLED;
        }
        if (from == STATUS_SETTLING) {
            return to == STATUS_SETTLED || to == STATUS_CANCELLED;
        }
        return false;
    }
}
