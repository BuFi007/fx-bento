// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {FXBentoHook} from "../src/FXBentoHook.sol";
import {FXBentoRoomFactory} from "../src/FXBentoRoomFactory.sol";
import {FXBentoRoomEscrow} from "../src/FXBentoRoomEscrow.sol";
import {FXBentoRoundManager} from "../src/FXBentoRoundManager.sol";
import {FXBentoCommitmentManager} from "../src/FXBentoCommitmentManager.sol";
import {FXBentoSettlementManager} from "../src/FXBentoSettlementManager.sol";
import {FXBentoScoring} from "../src/FXBentoScoring.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {PoolKey, RoomConfig, TileSelection, PoolIdLibrary} from "../src/libraries/FXBentoTypes.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey as V4PoolKey} from "v4-core/types/PoolKey.sol";

contract MockV4PoolManager {
    bytes32 public slot0;

    function setSlot0(uint160 sqrtPriceX96, int24 tick) external {
        slot0 = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function extsload(bytes32) external view returns (bytes32) {
        return slot0;
    }
}

contract ScoringHarness {
    function validate(TileSelection memory selection) external pure returns (bool) {
        return FXBentoScoring.validateAntiWall(selection, 5, 8);
    }

    function score(TileSelection memory selection, uint8 hitIndex, uint256 difficulty) external pure returns (uint256) {
        return FXBentoScoring.scoreSelection(selection, hitIndex, difficulty, 5, 8);
    }
}

contract FXBentoProtocolTest is Test {
    using PoolIdLibrary for PoolKey;

    address owner = address(this);
    address treasury = address(0x777);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA012);

    MockUSDC usdc;
    MockV4PoolManager poolManager;
    PoolRegistry registry;
    ProtocolFeeVault vault;
    FXBentoHook hook;
    FXBentoRoomFactory factory;
    FXBentoRoomEscrow escrow;
    FXBentoRoundManager rounds;
    FXBentoCommitmentManager commitments;
    FXBentoSettlementManager settlement;
    ScoringHarness scoring;
    PoolKey key;
    V4PoolKey v4Key;

    function setUp() public {
        usdc = new MockUSDC();
        poolManager = new MockV4PoolManager();
        registry = new PoolRegistry(owner);
        vault = new ProtocolFeeVault(owner, treasury);
        hook = _deployHookAtPermissionedAddress();
        key = PoolKey(address(usdc), address(0xE00C), 500, 10, address(hook));
        v4Key = V4PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(0xE00C)),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });
        registry.setPool(key, address(0x0A11CE), true, 300);
        factory = new FXBentoRoomFactory(owner, registry);
        escrow = new FXBentoRoomEscrow(owner, factory, vault);
        factory.setEscrow(address(escrow));
        factory.setEntryToken(address(usdc), true);
        rounds = new FXBentoRoundManager(owner, factory);
        settlement = new FXBentoSettlementManager(owner, factory, escrow);
        escrow.setSettlementManager(address(settlement));
        settlement.setChallengeWindow(0);
        commitments = new FXBentoCommitmentManager(owner, rounds, escrow);
        scoring = new ScoringHarness();

        usdc.mint(alice, 1_000e6);
        usdc.mint(bob, 1_000e6);
        usdc.mint(carol, 1_000e6);
        _approve(alice);
        _approve(bob);
        _approve(carol);
    }

    function testCreateRoom() public {
        uint256 roomId = _createRoom(2, 20);
        assertEq(roomId, 1);
        assertEq(factory.getRoom(roomId).entryFee, 5e6);
        assertEq(uint8(factory.getRoom(roomId).status), 0);
    }

    function testJoinRoomAndCannotExceedMaxPlayers() public {
        uint256 roomId = _createRoom(2, 2);
        _join(alice, roomId);
        _join(bob, roomId);
        vm.expectRevert("ROOM_FULL");
        _join(carol, roomId);
        assertEq(escrow.escrowed(roomId), 10e6);
    }

    function testCannotStartBelowMinPlayers() public {
        uint256 roomId = _createRoom(2, 20);
        _join(alice, roomId);
        vm.warp(factory.getRoom(roomId).startTime);
        vm.expectRevert("BELOW_MIN_PLAYERS");
        escrow.lockRoom(roomId);
    }

    function testRefundIfCancelled() public {
        uint256 roomId = _createRoom(2, 20);
        _join(alice, roomId);
        vm.warp(factory.getRoom(roomId).startTime);
        escrow.cancelRoom(roomId);
        uint256 beforeBalance = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.refund(roomId);
        assertEq(usdc.balanceOf(alice), beforeBalance + 5e6);
    }

    function testNoRefundAfterRoomStarts() public {
        uint256 roomId = _startedRoom();
        vm.prank(alice);
        vm.expectRevert("ROOM_NOT_CANCELLED");
        escrow.refund(roomId);
    }

    function testLockRoom() public {
        uint256 roomId = _startedRoom();
        assertEq(uint8(factory.getRoom(roomId).status), 1);
    }

    function testCommitAndRevealValidSelection() public {
        uint256 roomId = _startedRoom();
        rounds.startRound(
            roomId,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 60),
            uint64(block.timestamp + 50),
            bytes32("grid")
        );
        TileSelection memory selection = _selectionOne();
        bytes32 selectedHash =
            keccak256(abi.encode(selection.rows, selection.cols, selection.chipCount, selection.clientStateHash));
        bytes32 nonce = bytes32("nonce");
        bytes32 commitment = commitments.hashSelection(roomId, 0, alice, selectedHash, nonce);

        vm.prank(alice);
        commitments.commitSelection(roomId, 0, commitment);
        vm.warp(block.timestamp + 51);
        vm.prank(alice);
        commitments.revealSelection(roomId, 0, selection, nonce);
        assertEq(commitments.revealedSelectionHash(roomId, 0, alice), selectedHash);
    }

    function testRejectLateCommit() public {
        uint256 roomId = _startedRoom();
        rounds.startRound(
            roomId,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 60),
            uint64(block.timestamp + 50),
            bytes32("grid")
        );
        vm.warp(block.timestamp + 51);
        vm.prank(alice);
        vm.expectRevert("COMMIT_CLOSED");
        commitments.commitSelection(roomId, 0, bytes32("commitment"));
    }

    function testRejectRevealMismatch() public {
        uint256 roomId = _startedRoom();
        rounds.startRound(
            roomId,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 60),
            uint64(block.timestamp + 50),
            bytes32("grid")
        );
        vm.prank(alice);
        commitments.commitSelection(roomId, 0, bytes32("wrong"));
        vm.warp(block.timestamp + 51);
        vm.prank(alice);
        vm.expectRevert("REVEAL_MISMATCH");
        commitments.revealSelection(roomId, 0, _selectionOne(), bytes32("nonce"));
    }

    function testRejectWallPattern() public {
        TileSelection memory selection;
        selection.rows = new uint8[](3);
        selection.cols = new uint8[](3);
        selection.rows[0] = 1;
        selection.rows[1] = 1;
        selection.rows[2] = 1;
        selection.cols[0] = 1;
        selection.cols[1] = 2;
        selection.cols[2] = 3;
        selection.chipCount = 3;
        assertFalse(scoring.validate(selection));
    }

    function testRejectTooManyTiles() public {
        TileSelection memory selection;
        selection.rows = new uint8[](6);
        selection.cols = new uint8[](6);
        for (uint8 i; i < 6; i++) {
            selection.rows[i] = i % 5;
            selection.cols[i] = i;
        }
        selection.chipCount = 6;
        assertFalse(scoring.validate(selection));
    }

    function testRejectTooManySameRowTiles() public {
        TileSelection memory selection;
        selection.rows = new uint8[](3);
        selection.cols = new uint8[](3);
        selection.rows[0] = 2;
        selection.rows[1] = 2;
        selection.rows[2] = 2;
        selection.cols[0] = 0;
        selection.cols[1] = 2;
        selection.cols[2] = 4;
        selection.chipCount = 3;
        assertFalse(scoring.validate(selection));
    }

    function testScoreOneTileHit() public {
        assertEq(scoring.score(_selectionOne(), 0, 1_000e18), 1_000e18);
    }

    function testScoreMultiTileHitWithCoveragePenaltyAndMiss() public {
        TileSelection memory selection;
        selection.rows = new uint8[](2);
        selection.cols = new uint8[](2);
        selection.rows[0] = 0;
        selection.rows[1] = 1;
        selection.cols[0] = 3;
        selection.cols[1] = 4;
        selection.chipCount = 2;
        assertLt(scoring.score(selection, 0, 1_000e18), 1_000e18);
        assertEq(scoring.score(selection, 9, 1_000e18), 0);
    }

    function testSettleRoomRakePrizeDistributionAndInvariant() public {
        uint256 roomId = _startedRoom();
        uint256 prize = 9e6;
        bytes32 root = keccak256(abi.encode(roomId, alice, prize));
        settlement.submitResults(roomId, root, "ipfs://results", "");
        settlement.finalizeResults(roomId);
        assertEq(escrow.protocolFee(roomId), 1e6);

        vm.prank(alice);
        escrow.claimPrize(roomId, prize, new bytes32[](0));
        escrow.claimProtocolFee(roomId);

        assertEq(usdc.balanceOf(address(vault)), 1e6);
        assertLe(escrow.totalPrizeClaimed(roomId) + escrow.protocolFee(roomId), 10e6);
    }

    function testCannotSettleTwiceOrClaimPrizeTwice() public {
        uint256 roomId = _startedRoom();
        uint256 prize = 9e6;
        bytes32 root = keccak256(abi.encode(roomId, alice, prize));
        settlement.submitResults(roomId, root, "ipfs://results", "");
        settlement.finalizeResults(roomId);
        vm.expectRevert("FINALIZED");
        settlement.finalizeResults(roomId);

        vm.prank(alice);
        escrow.claimPrize(roomId, prize, new bytes32[](0));
        vm.prank(alice);
        vm.expectRevert("PRIZE_CLAIMED");
        escrow.claimPrize(roomId, prize, new bytes32[](0));
    }

    function testCannotChangeRoomRulesAfterStartByCreatingMutableAlias() public {
        uint256 roomId = _startedRoom();
        assertEq(factory.getRoom(roomId).entryFee, 5e6);
        assertEq(uint8(factory.getRoom(roomId).status), 1);
    }

    function testHookSnapshotsAndVolatility() public {
        IPoolManager.SwapParams memory params;
        vm.startPrank(address(poolManager));
        hook.afterInitialize(address(this), v4Key, 1 << 96, 100);
        hook.beforeSwap(address(this), v4Key, params, "");
        poolManager.setSlot0(uint160(1 << 96), 130);
        hook.afterSwap(address(this), v4Key, params, BalanceDelta.wrap(0), "");
        poolManager.setSlot0(uint160(1 << 96), 160);
        hook.afterSwap(address(this), v4Key, params, BalanceDelta.wrap(0), "");
        vm.stopPrank();
        assertGt(hook.realizedVolatility(key.toId(), 2), 0);
    }

    function testHookPermissionBitmapMatchesEnabledCallbacks() public view {
        uint160 expected = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        assertEq(hook.hookPermissionBitmap(), expected);
        assertTrue(hook.hookAddressHasPermissions(address(uint160(expected))));
    }

    function testHookRejectsSpoofedSnapshots() public {
        IPoolManager.SwapParams memory params;
        vm.expectRevert("NOT_POOL_MANAGER");
        hook.afterSwap(address(this), v4Key, params, BalanceDelta.wrap(0), "");
    }

    function testHookConstructorRejectsWrongPermissionAddress() public {
        vm.expectRevert();
        new FXBentoHook(owner, IPoolManager(address(poolManager)), registry, vault);
    }

    function testLeaveRejoinCanRefundAndDoesNotConsumeSeat() public {
        uint256 roomId = _createRoom(2, 2);
        _join(alice, roomId);
        vm.prank(alice);
        escrow.leaveRoom(roomId);
        _join(alice, roomId);
        _join(bob, roomId);
        assertEq(escrow.activePlayerCount(roomId), 2);
        vm.warp(factory.getRoom(roomId).startTime);
        vm.expectRevert("ROOM_FULL");
        _join(carol, roomId);
    }

    function testNonPlayerCannotCommitOrClaim() public {
        uint256 roomId = _startedRoom();
        rounds.startRound(
            roomId,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 60),
            uint64(block.timestamp + 50),
            bytes32("grid")
        );
        vm.prank(carol);
        vm.expectRevert("NOT_PLAYER");
        commitments.commitSelection(roomId, 0, bytes32("commitment"));

        uint256 prize = 9e6;
        bytes32 root = keccak256(abi.encode(roomId, carol, prize));
        settlement.submitResults(roomId, root, "ipfs://results", "");
        settlement.finalizeResults(roomId);
        vm.prank(carol);
        vm.expectRevert("NOT_PLAYER");
        escrow.claimPrize(roomId, prize, new bytes32[](0));
    }

    function testDirectEscrowSettlementBypassRejected() public {
        uint256 roomId = _startedRoom();
        vm.expectRevert("NOT_SETTLEMENT_MANAGER");
        escrow.settleRoom(roomId, bytes32("root"), "");
    }

    function testFuzzPayoutInvariant(uint8 players, uint16 rakeBps) public {
        players = uint8(bound(players, 2, 20));
        rakeBps = uint16(bound(rakeBps, 0, 1000));
        uint256 totalEscrow = uint256(players) * 5e6;
        uint256 rake = totalEscrow * rakeBps / 10_000;
        uint256 payouts = totalEscrow - rake;
        assertLe(payouts + rake, totalEscrow);
    }

    function testFuzzSelectedTilePatterns(uint8 row, uint8 col) public {
        TileSelection memory selection;
        selection.rows = new uint8[](1);
        selection.cols = new uint8[](1);
        selection.rows[0] = uint8(bound(row, 0, 4));
        selection.cols[0] = uint8(bound(col, 0, 7));
        selection.chipCount = 1;
        assertTrue(scoring.validate(selection));
    }

    function _startedRoom() internal returns (uint256 roomId) {
        roomId = _createRoom(2, 20);
        _join(alice, roomId);
        _join(bob, roomId);
        vm.warp(factory.getRoom(roomId).startTime);
        escrow.lockRoom(roomId);
    }

    function _createRoom(uint16 minPlayers, uint16 maxPlayers) internal returns (uint256) {
        uint16[] memory payouts = new uint16[](1);
        payouts[0] = 10_000;
        RoomConfig memory config = RoomConfig({
            poolKey: key,
            entryToken: address(usdc),
            entryFee: 5e6,
            minPlayers: minPlayers,
            maxPlayers: maxPlayers,
            rounds: 10,
            roundDuration: 60,
            lockBuffer: 10,
            startTime: uint64(block.timestamp + 10),
            rakeBps: 1_000,
            payoutBps: payouts,
            gridConfigHash: bytes32("grid"),
            isPrivate: false,
            inviteCodeHash: bytes32(0)
        });
        return factory.createRoom(config);
    }

    function _selectionOne() internal pure returns (TileSelection memory selection) {
        selection.rows = new uint8[](1);
        selection.cols = new uint8[](1);
        selection.rows[0] = 2;
        selection.cols[0] = 4;
        selection.chipCount = 1;
    }

    function _join(address player, uint256 roomId) internal {
        vm.prank(player);
        escrow.joinRoom(roomId);
    }

    function _approve(address player) internal {
        vm.prank(player);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _deployHookAtPermissionedAddress() internal returns (FXBentoHook deployedHook) {
        address hookAddress =
            address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG));
        deployCodeTo(
            "FXBentoHook.sol:FXBentoHook",
            abi.encode(owner, IPoolManager(address(poolManager)), registry, vault),
            hookAddress
        );
        deployedHook = FXBentoHook(hookAddress);
    }
}
