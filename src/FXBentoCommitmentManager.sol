// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessManaged} from "./libraries/Guards.sol";
import {Round, TileSelection} from "./libraries/FXBentoTypes.sol";
import {FXBentoScoring} from "./FXBentoScoring.sol";
import {FXBentoRoundManager} from "./FXBentoRoundManager.sol";

contract FXBentoCommitmentManager is AccessManaged {
    using FXBentoScoring for TileSelection;

    bytes32 public constant BATCHER_ROLE = keccak256("BATCHER_ROLE");
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant COMMITMENT_TYPEHASH =
        keccak256("TileCommitment(uint256 roomId,uint16 roundIndex,address player,bytes32 commitment)");

    FXBentoRoundManager public immutable roundManager;
    mapping(uint256 => mapping(uint16 => mapping(address => bytes32))) public commitments;
    mapping(uint256 => mapping(uint16 => mapping(address => bytes32))) public revealedSelectionHash;

    event SelectionCommitted(
        uint256 indexed roomId, uint16 indexed roundIndex, address indexed player, bytes32 commitment
    );
    event SelectionRevealed(
        uint256 indexed roomId, uint16 indexed roundIndex, address indexed player, bytes32 selectedTilesHash
    );

    constructor(address owner_, FXBentoRoundManager roundManager_) AccessManaged(owner_) {
        roundManager = roundManager_;
        DOMAIN_SEPARATOR = keccak256(abi.encode(block.chainid, address(this)));
    }

    function hashSelection(uint256 roomId, uint16 roundIndex, address player, bytes32 selectedTilesHash, bytes32 nonce)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, roomId, roundIndex, player, selectedTilesHash, nonce));
    }

    function commitSelection(uint256 roomId, uint16 roundIndex, bytes32 commitment) external {
        _commit(roomId, roundIndex, msg.sender, commitment);
    }

    function commitSelectionFor(
        uint256 roomId,
        uint16 roundIndex,
        address player,
        bytes32 commitment,
        bytes calldata signature
    ) external onlyRole(BATCHER_ROLE) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(COMMITMENT_TYPEHASH, roomId, roundIndex, player, commitment))
            )
        );
        require(_recover(digest, signature) == player, "BAD_SIGNATURE");
        _commit(roomId, roundIndex, player, commitment);
    }

    function revealSelection(uint256 roomId, uint16 roundIndex, TileSelection calldata selection, bytes32 nonce)
        external
    {
        Round memory round = roundManager.getRound(roomId, roundIndex);
        require(round.status == 1, "ROUND_NOT_ACTIVE");
        require(block.timestamp >= round.lockTime, "TOO_EARLY");
        require(block.timestamp <= round.endTime + 5 minutes, "REVEAL_CLOSED");
        bytes32 selectedTilesHash =
            keccak256(abi.encode(selection.rows, selection.cols, selection.chipCount, selection.clientStateHash));
        require(
            commitments[roomId][roundIndex][msg.sender]
                == hashSelection(roomId, roundIndex, msg.sender, selectedTilesHash, nonce),
            "REVEAL_MISMATCH"
        );
        require(FXBentoScoring.validateAntiWall(selection, 5, 8), "INVALID_PATTERN");
        revealedSelectionHash[roomId][roundIndex][msg.sender] = selectedTilesHash;
        emit SelectionRevealed(roomId, roundIndex, msg.sender, selectedTilesHash);
    }

    function _commit(uint256 roomId, uint16 roundIndex, address player, bytes32 commitment) internal {
        Round memory round = roundManager.getRound(roomId, roundIndex);
        require(round.status == 1, "ROUND_NOT_ACTIVE");
        require(block.timestamp < round.lockTime, "COMMIT_CLOSED");
        require(commitments[roomId][roundIndex][player] == bytes32(0), "ALREADY_COMMITTED");
        commitments[roomId][roundIndex][player] = commitment;
        emit SelectionCommitted(roomId, roundIndex, player, commitment);
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "BAD_SIG_LENGTH");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }
}
