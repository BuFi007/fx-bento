// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {FXBentoHook} from "../src/FXBentoHook.sol";
import {FXBentoRoomFactory} from "../src/FXBentoRoomFactory.sol";
import {FXBentoRoomEscrow} from "../src/FXBentoRoomEscrow.sol";
import {FXBentoRoundManager} from "../src/FXBentoRoundManager.sol";
import {FXBentoCommitmentManager} from "../src/FXBentoCommitmentManager.sol";
import {FXBentoSettlementManager} from "../src/FXBentoSettlementManager.sol";

contract DeployFXBento is Script {
    function run() external {
        address owner = vm.envOr("OWNER", msg.sender);
        address treasury = vm.envOr("TREASURY", owner);
        address poolManager = vm.envOr("POOL_MANAGER", address(0x1111));
        vm.startBroadcast();
        PoolRegistry registry = new PoolRegistry(owner);
        ProtocolFeeVault vault = new ProtocolFeeVault(owner, treasury);
        new FXBentoHook(owner, poolManager, registry, vault);
        FXBentoRoomFactory factory = new FXBentoRoomFactory(owner, registry);
        FXBentoRoomEscrow escrow = new FXBentoRoomEscrow(owner, factory, vault);
        factory.setEscrow(address(escrow));
        FXBentoRoundManager rounds = new FXBentoRoundManager(owner, factory);
        FXBentoSettlementManager settlement = new FXBentoSettlementManager(owner, factory, escrow);
        escrow.setSettlementManager(address(settlement));
        new FXBentoCommitmentManager(owner, rounds, escrow);
        vm.stopBroadcast();
    }
}
