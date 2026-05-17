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
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

contract DeployFXBento is Script {
    function run() external {
        address owner = vm.envOr("OWNER", msg.sender);
        address treasury = vm.envOr("TREASURY", owner);
        address poolManager = vm.envAddress("POOL_MANAGER");
        bytes32 hookSalt = vm.envBytes32("HOOK_SALT");
        vm.startBroadcast();
        PoolRegistry registry = new PoolRegistry(owner);
        ProtocolFeeVault vault = new ProtocolFeeVault(owner, treasury);
        FXBentoHook hook = new FXBentoHook{salt: hookSalt}(owner, IPoolManager(poolManager), registry, vault);
        require(hook.hookAddressHasPermissions(address(hook)), "INVALID_HOOK_ADDRESS");
        FXBentoRoomFactory factory = new FXBentoRoomFactory(owner, registry);
        FXBentoRoomEscrow escrow = new FXBentoRoomEscrow(owner, factory, vault);
        factory.setEscrow(address(escrow));
        FXBentoRoundManager rounds = new FXBentoRoundManager(owner, factory, hook);
        FXBentoSettlementManager settlement = new FXBentoSettlementManager(owner, factory, escrow);
        escrow.setSettlementManager(address(settlement));
        settlement.setRoundManager(rounds);
        new FXBentoCommitmentManager(owner, rounds, escrow);
        vm.stopBroadcast();
    }
}
