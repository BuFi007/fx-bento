// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged, ReentrancyGuard} from "./libraries/Guards.sol";
import {IERC20, SafeERC20} from "./libraries/MinimalTokens.sol";
import {MerkleProof} from "./libraries/MerkleProof.sol";
import {RoomView} from "./libraries/FXBentoTypes.sol";
import {FXBentoRoomFactory} from "./FXBentoRoomFactory.sol";
import {ProtocolFeeVault} from "./ProtocolFeeVault.sol";

contract FXBentoRoomEscrow is AccessManaged, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    uint16 public constant BPS = 10_000;

    FXBentoRoomFactory public immutable factory;
    ProtocolFeeVault public immutable protocolFeeVault;

    mapping(uint256 => address[]) private roomPlayers;
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(uint256 => mapping(address => bool)) public refunded;
    mapping(uint256 => mapping(address => bool)) public prizeClaimed;
    mapping(uint256 => bytes32) public resultsRoot;
    mapping(uint256 => uint256) public escrowed;
    mapping(uint256 => uint256) public protocolFee;
    mapping(uint256 => uint256) public totalPrizeClaimed;
    mapping(uint256 => bool) public protocolFeeClaimed;

    event RoomJoined(uint256 indexed roomId, address indexed player);
    event RoomLeft(uint256 indexed roomId, address indexed player);
    event RoomCancelled(uint256 indexed roomId);
    event RoomLocked(uint256 indexed roomId, uint256 escrowed);
    event RoomSettled(uint256 indexed roomId, bytes32 resultsRoot, uint256 protocolFee);
    event Refunded(uint256 indexed roomId, address indexed player, uint256 amount);
    event PrizeClaimed(uint256 indexed roomId, address indexed player, uint256 amount);
    event ProtocolFeeClaimed(uint256 indexed roomId, uint256 amount);

    constructor(address owner_, FXBentoRoomFactory factory_, ProtocolFeeVault protocolFeeVault_) AccessManaged(owner_) {
        factory = factory_;
        protocolFeeVault = protocolFeeVault_;
    }

    function joinRoom(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_NOT_LOBBY");
        require(!joined[roomId][msg.sender], "ALREADY_JOINED");
        require(roomPlayers[roomId].length < room.maxPlayers, "ROOM_FULL");
        joined[roomId][msg.sender] = true;
        roomPlayers[roomId].push(msg.sender);
        escrowed[roomId] += room.entryFee;
        IERC20(room.entryToken).safeTransferFrom(msg.sender, address(this), room.entryFee);
        emit RoomJoined(roomId, msg.sender);
    }

    function leaveRoom(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_STARTED");
        require(joined[roomId][msg.sender], "NOT_JOINED");
        joined[roomId][msg.sender] = false;
        refunded[roomId][msg.sender] = true;
        escrowed[roomId] -= room.entryFee;
        IERC20(room.entryToken).safeTransfer(msg.sender, room.entryFee);
        emit RoomLeft(roomId, msg.sender);
    }

    function cancelRoom(uint256 roomId) external {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_NOT_LOBBY");
        require(
            roomPlayers[roomId].length < room.minPlayers || block.timestamp > room.startTime + room.roundDuration,
            "CANNOT_CANCEL"
        );
        factory.setRoomStatus(roomId, 4);
        emit RoomCancelled(roomId);
    }

    function refund(uint256 roomId) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 4, "ROOM_NOT_CANCELLED");
        require(joined[roomId][msg.sender] && !refunded[roomId][msg.sender], "NO_REFUND");
        refunded[roomId][msg.sender] = true;
        joined[roomId][msg.sender] = false;
        escrowed[roomId] -= room.entryFee;
        IERC20(room.entryToken).safeTransfer(msg.sender, room.entryFee);
        emit Refunded(roomId, msg.sender, room.entryFee);
    }

    function lockRoom(uint256 roomId) external {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 0, "ROOM_NOT_LOBBY");
        require(roomPlayers[roomId].length >= room.minPlayers, "BELOW_MIN_PLAYERS");
        factory.setRoomStatus(roomId, 1);
        emit RoomLocked(roomId, escrowed[roomId]);
    }

    function settleRoom(uint256 roomId, bytes32 root, bytes calldata) public onlyRole(SETTLER_ROLE) {
        require(resultsRoot[roomId] == bytes32(0), "ALREADY_SETTLED");
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 1 || room.status == 2, "ROOM_NOT_SETTLING");
        uint256 fee = escrowed[roomId] * room.rakeBps / BPS;
        protocolFee[roomId] = fee;
        resultsRoot[roomId] = root;
        factory.setRoomStatus(roomId, 3);
        emit RoomSettled(roomId, root, fee);
    }

    function claimPrize(uint256 roomId, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        RoomView memory room = factory.getRoom(roomId);
        require(room.status == 3, "ROOM_NOT_SETTLED");
        require(!prizeClaimed[roomId][msg.sender], "PRIZE_CLAIMED");
        bytes32 leaf = keccak256(abi.encode(roomId, msg.sender, amount));
        require(MerkleProof.verify(proof, resultsRoot[roomId], leaf), "BAD_PROOF");
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
        protocolFeeClaimed[roomId] = true;
        IERC20(room.entryToken).safeTransfer(address(protocolFeeVault), protocolFee[roomId]);
        protocolFeeVault.notifyFee(room.entryToken, roomId, protocolFee[roomId]);
        emit ProtocolFeeClaimed(roomId, protocolFee[roomId]);
    }

    function players(uint256 roomId) external view returns (address[] memory) {
        return roomPlayers[roomId];
    }
}
