// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {FXBentoHookHarness} from "./harnesses/FXBentoHookHarness.sol";
import {FXBentoRoomFactory} from "../src/FXBentoRoomFactory.sol";
import {FXBentoRoomEscrow} from "../src/FXBentoRoomEscrow.sol";
import {FXBentoRoundManager} from "../src/FXBentoRoundManager.sol";
import {FXBentoSettlementManager} from "../src/FXBentoSettlementManager.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {PayoutRoot, PoolKey, RoomConfig, PoolIdLibrary} from "../src/libraries/FXBentoTypes.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

contract AccountingMockV4PoolManager {
    bytes32 public slot0;

    function setSlot0(uint160 sqrtPriceX96, int24 tick) external {
        slot0 = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function extsload(bytes32) external view returns (bytes32) {
        return slot0;
    }
}

contract FXBentoAccountingHandler is Test {
    using PoolIdLibrary for PoolKey;

    address[3] public players;
    MockUSDC public usdc;
    FXBentoRoomFactory public factory;
    FXBentoRoomEscrow public escrow;
    FXBentoRoundManager public rounds;
    FXBentoSettlementManager public settlement;
    FXBentoHookHarness public hook;
    PoolKey public key;
    uint256[] public roomIds;

    constructor(
        MockUSDC usdc_,
        FXBentoRoomFactory factory_,
        FXBentoRoomEscrow escrow_,
        FXBentoRoundManager rounds_,
        FXBentoSettlementManager settlement_,
        FXBentoHookHarness hook_,
        PoolKey memory key_,
        address[3] memory players_
    ) {
        usdc = usdc_;
        factory = factory_;
        escrow = escrow_;
        rounds = rounds_;
        settlement = settlement_;
        hook = hook_;
        key = key_;
        players = players_;
    }

    function createRoom(uint8 minPlayers, uint8 maxPlayers, uint16 rakeBps) external {
        if (roomIds.length >= 8) return;
        minPlayers = uint8(bound(minPlayers, 2, 3));
        maxPlayers = uint8(bound(maxPlayers, minPlayers, 3));
        rakeBps = uint16(bound(rakeBps, 0, 1_000));
        uint16[] memory payouts = new uint16[](1);
        payouts[0] = 10_000;
        RoomConfig memory config = RoomConfig({
            poolKey: key,
            entryToken: address(usdc),
            entryFee: 5e6,
            minPlayers: minPlayers,
            maxPlayers: maxPlayers,
            rounds: 2,
            roundDuration: 60,
            lockBuffer: 10,
            startTime: uint64(block.timestamp + 10),
            rakeBps: rakeBps,
            payoutBps: payouts,
            gridConfigHash: bytes32("grid"),
            isPrivate: false,
            inviteCodeHash: bytes32(0)
        });
        roomIds.push(factory.createRoom(config));
    }

    function join(uint256 roomSeed, uint256 playerSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        address player = players[bound(playerSeed, 0, players.length - 1)];
        if (factory.getRoom(roomId).status != 0) return;
        if (escrow.joined(roomId, player)) return;
        if (escrow.activePlayerCount(roomId) >= factory.getRoom(roomId).maxPlayers) return;
        vm.prank(player);
        escrow.joinRoom(roomId);
    }

    function leave(uint256 roomSeed, uint256 playerSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        address player = players[bound(playerSeed, 0, players.length - 1)];
        if (factory.getRoom(roomId).status != 0) return;
        if (!escrow.joined(roomId, player)) return;
        vm.prank(player);
        escrow.leaveRoom(roomId);
    }

    function lock(uint256 roomSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        if (factory.getRoom(roomId).status != 0) return;
        if (escrow.activePlayerCount(roomId) < factory.getRoom(roomId).minPlayers) return;
        vm.warp(factory.getRoom(roomId).startTime);
        escrow.lockRoom(roomId);
    }

    function cancelLobby(uint256 roomSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        if (factory.getRoom(roomId).status != 0) return;
        if (escrow.activePlayerCount(roomId) >= factory.getRoom(roomId).minPlayers) return;
        vm.warp(factory.getRoom(roomId).startTime);
        escrow.cancelRoom(roomId);
    }

    function refund(uint256 roomSeed, uint256 playerSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        address player = players[bound(playerSeed, 0, players.length - 1)];
        if (factory.getRoom(roomId).status != 4) return;
        if (!escrow.joined(roomId, player) || escrow.refunded(roomId, player)) return;
        vm.prank(player);
        escrow.refund(roomId);
    }

    function settle(uint256 roomSeed, uint256 winnerSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        if (factory.getRoom(roomId).status != 1) return;
        if (rounds.getRound(roomId, 0).status != 0) return;
        address winner = players[bound(winnerSeed, 0, players.length - 1)];
        if (!escrow.joined(roomId, winner)) return;
        try this.settleRoomAction(roomId, winner) {} catch {}
    }

    function settleRoomAction(uint256 roomId, address winner) external {
        require(msg.sender == address(this), "ONLY_SELF");
        _settleRounds(roomId);
        uint256 fee = escrow.escrowed(roomId) * factory.getRoom(roomId).rakeBps / escrow.BPS();
        uint256 prize = escrow.escrowed(roomId) - fee;
        settlement.submitResults(roomId, _payoutRoot(roomId, winner, prize, fee), "ipfs://results", "");
        settlement.finalizeResults(roomId);
    }

    function claimPrize(uint256 roomSeed, uint256 playerSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        address player = players[bound(playerSeed, 0, players.length - 1)];
        if (factory.getRoom(roomId).status != 3) return;
        if (!escrow.joined(roomId, player) || escrow.prizeClaimed(roomId, player)) return;
        uint256 amount = _leafAmount(roomId, player);
        if (amount == 0) return;
        vm.prank(player);
        escrow.claimPrize(roomId, amount, new bytes32[](0));
    }

    function claimProtocolFee(uint256 roomSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        if (factory.getRoom(roomId).status != 3 || escrow.protocolFeeClaimed(roomId)) return;
        escrow.claimProtocolFee(roomId);
    }

    function rescue(uint256 roomSeed) external {
        if (roomIds.length == 0) return;
        uint256 roomId = roomIds[bound(roomSeed, 0, roomIds.length - 1)];
        uint8 status = factory.getRoom(roomId).status;
        if (status != 1 && status != 2) return;
        vm.warp(settlement.settlementRescueDeadline(roomId));
        settlement.rescueFailedSettlement(roomId);
    }

    function roomCount() external view returns (uint256) {
        return roomIds.length;
    }

    function roomAt(uint256 index) external view returns (uint256) {
        return roomIds[index];
    }

    function _settleRounds(uint256 roomId) internal {
        uint64 firstStart = factory.getRoom(roomId).startTime;
        for (uint16 i; i < factory.getRoom(roomId).rounds; i++) {
            uint64 start = firstStart + uint64(i) * 60;
            vm.warp(start);
            hook.recordSnapshotForTesting(key, uint160(1 << 96), int24(100 + int16(i)));
            rounds.startRound(roomId, i, start, start + 60, start + 50, bytes32("grid"));
            vm.warp(start + 60);
            hook.recordSnapshotForTesting(key, uint160(1 << 96), int24(130 + int16(i)));
            rounds.recordSettlement(roomId, i);
        }
    }

    function _leafAmount(uint256 roomId, address player) internal view returns (uint256) {
        uint256 fee = escrow.protocolFee(roomId);
        uint256 prize = escrow.escrowed(roomId) - fee;
        if (escrow.resultsRoot(roomId) == keccak256(abi.encode(roomId, player, prize))) return prize;
        return 0;
    }

    function _payoutRoot(uint256 roomId, address winner, uint256 prize, uint256 fee)
        internal
        pure
        returns (PayoutRoot memory)
    {
        return PayoutRoot({
            roomId: roomId,
            winnerRoot: keccak256(abi.encode(roomId, winner, prize)),
            rosterHash: keccak256(abi.encodePacked("roster", roomId)),
            leaderboardHash: keccak256(abi.encodePacked("leaderboard", roomId)),
            scoreRoot: keccak256(abi.encodePacked("score", roomId)),
            settlementPriceRoot: keccak256(abi.encodePacked("settlement-price", roomId)),
            payoutTotal: prize,
            protocolFee: fee,
            metadataHash: keccak256(bytes("ipfs://results"))
        });
    }
}

contract FXBentoAccountingInvariantTest is StdInvariant, Test {
    using PoolIdLibrary for PoolKey;

    address owner = address(this);
    address treasury = address(0x777);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA012);

    MockUSDC usdc;
    AccountingMockV4PoolManager poolManager;
    PoolRegistry registry;
    ProtocolFeeVault vault;
    FXBentoHookHarness hook;
    FXBentoRoomFactory factory;
    FXBentoRoomEscrow escrow;
    FXBentoRoundManager rounds;
    FXBentoSettlementManager settlement;
    FXBentoAccountingHandler handler;
    PoolKey key;

    function setUp() public {
        usdc = new MockUSDC();
        poolManager = new AccountingMockV4PoolManager();
        registry = new PoolRegistry(owner);
        vault = new ProtocolFeeVault(owner, treasury);
        hook = _deployHookAtPermissionedAddress();
        key = PoolKey(address(usdc), address(0xE00C), 500, 10, address(hook));
        registry.setPool(key, address(0x0A11CE), true, 300);
        factory = new FXBentoRoomFactory(owner, registry);
        escrow = new FXBentoRoomEscrow(owner, factory, vault);
        factory.setEscrow(address(escrow));
        vault.setFeeNotifier(address(escrow));
        factory.setEntryToken(address(usdc), true);
        rounds = new FXBentoRoundManager(owner, factory, hook);
        settlement = new FXBentoSettlementManager(owner, factory, escrow);
        escrow.setSettlementManager(address(settlement));
        settlement.setRoundManager(rounds);
        settlement.setChallengeWindow(0);
        settlement.setSettlementRescueDelay(10);

        address[3] memory players = [alice, bob, carol];
        handler = new FXBentoAccountingHandler(usdc, factory, escrow, rounds, settlement, hook, key, players);
        hook.transferOwnership(address(handler));
        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
        usdc.mint(carol, 1_000_000e6);
        for (uint256 i; i < players.length; i++) {
            vm.prank(players[i]);
            usdc.approve(address(escrow), type(uint256).max);
        }

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: _selectors()}));
    }

    function invariant_EscrowTokenBalanceMatchesOutstandingRoomAccounting() public view {
        assertEq(usdc.balanceOf(address(escrow)), _outstandingEscrow());
    }

    function invariant_PrizeClaimsAndProtocolFeesNeverExceedEscrow() public view {
        uint256 count = handler.roomCount();
        for (uint256 i; i < count; i++) {
            uint256 roomId = handler.roomAt(i);
            uint256 feePaid = escrow.protocolFeeClaimed(roomId) ? escrow.protocolFee(roomId) : 0;
            assertLe(escrow.totalPrizeClaimed(roomId) + feePaid, escrow.escrowed(roomId));
            assertLe(escrow.totalPrizeClaimed(roomId), escrow.payoutTotal(roomId));
            if (escrow.resultsRoot(roomId) != bytes32(0)) {
                assertLe(escrow.payoutTotal(roomId) + escrow.protocolFee(roomId), escrow.escrowed(roomId));
            }
        }
    }

    function invariant_ActiveRosterMatchesRoomAccounting() public view {
        uint256 count = handler.roomCount();
        for (uint256 i; i < count; i++) {
            uint256 roomId = handler.roomAt(i);
            uint256 activeCount = _activeRosterCount(roomId);
            assertEq(escrow.activePlayerCount(roomId), activeCount);
            assertEq(escrow.escrowed(roomId), activeCount * factory.getRoom(roomId).entryFee);
        }
    }

    function invariant_NoTokensCreatedByLifecycle() public view {
        uint256 playerBalances = usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol);
        uint256 protocolBalances = usdc.balanceOf(address(escrow)) + usdc.balanceOf(address(vault));
        assertEq(playerBalances + protocolBalances, 3_000_000e6);
    }

    function _outstandingEscrow() internal view returns (uint256 outstanding) {
        uint256 count = handler.roomCount();
        for (uint256 i; i < count; i++) {
            uint256 roomId = handler.roomAt(i);
            uint256 feePaid = escrow.protocolFeeClaimed(roomId) ? escrow.protocolFee(roomId) : 0;
            outstanding += escrow.escrowed(roomId) - escrow.totalPrizeClaimed(roomId) - feePaid;
        }
    }

    function _activeRosterCount(uint256 roomId) internal view returns (uint256 activeCount) {
        address[3] memory players = [alice, bob, carol];
        for (uint256 i; i < players.length; i++) {
            if (escrow.joined(roomId, players[i]) && !escrow.refunded(roomId, players[i])) {
                activeCount += 1;
            }
        }
    }

    function _selectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](10);
        selectors[0] = FXBentoAccountingHandler.createRoom.selector;
        selectors[1] = FXBentoAccountingHandler.join.selector;
        selectors[2] = FXBentoAccountingHandler.leave.selector;
        selectors[3] = FXBentoAccountingHandler.lock.selector;
        selectors[4] = FXBentoAccountingHandler.cancelLobby.selector;
        selectors[5] = FXBentoAccountingHandler.refund.selector;
        selectors[6] = FXBentoAccountingHandler.settle.selector;
        selectors[7] = FXBentoAccountingHandler.claimPrize.selector;
        selectors[8] = FXBentoAccountingHandler.claimProtocolFee.selector;
        selectors[9] = FXBentoAccountingHandler.rescue.selector;
    }

    function _deployHookAtPermissionedAddress() internal returns (FXBentoHookHarness deployedHook) {
        address hookAddress =
            address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG));
        deployCodeTo(
            "FXBentoHookHarness.sol:FXBentoHookHarness",
            abi.encode(owner, IPoolManager(address(poolManager)), registry, vault),
            hookAddress
        );
        deployedHook = FXBentoHookHarness(hookAddress);
    }
}
