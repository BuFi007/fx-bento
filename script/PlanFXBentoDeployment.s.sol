// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FXBentoHook} from "../src/FXBentoHook.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

contract PlanFXBentoDeployment is Script {
    uint160 private constant REQUIRED_PERMISSIONS =
        Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    function run() external view {
        address deployer = vm.envOr("DEPLOYER", msg.sender);
        uint256 nonce = vm.envOr("DEPLOYER_NONCE", vm.getNonce(deployer));
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", owner);
        address poolManager = vm.envAddress("POOL_MANAGER");
        uint256 attempts = vm.envOr("HOOK_MINE_ATTEMPTS", uint256(5_000_000));

        address registry = vm.computeCreateAddress(deployer, nonce);
        address vault = vm.computeCreateAddress(deployer, nonce + 1);

        (bytes32 salt, address hook) = _mineHookSalt(deployer, owner, poolManager, registry, vault, attempts);

        console2.log("FX Bento deployer", deployer);
        console2.log("FX Bento deployer nonce", nonce);
        console2.log("PoolRegistry predicted", registry);
        console2.log("ProtocolFeeVault predicted", vault);
        console2.log("FXBentoHook predicted", hook);
        console2.log("FXBentoHook salt:");
        console2.logBytes32(salt);
        console2.log("Owner", owner);
        console2.log("Treasury", treasury);
        console2.log("PoolManager", poolManager);
    }

    function _mineHookSalt(
        address deployer,
        address owner,
        address poolManager,
        address registry,
        address vault,
        uint256 attempts
    ) private pure returns (bytes32 foundSalt, address predictedHook) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(FXBentoHook).creationCode,
                abi.encode(owner, IPoolManager(poolManager), PoolRegistry(registry), ProtocolFeeVault(vault))
            )
        );

        for (uint256 i; i < attempts; i++) {
            bytes32 salt = bytes32(i);
            address predicted = _computeCreate2Address(deployer, salt, initCodeHash);
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == REQUIRED_PERMISSIONS) {
                return (salt, predicted);
            }
        }

        revert("NO_SALT_FOUND");
    }

    function _computeCreate2Address(address deployer, bytes32 salt, bytes32 initCodeHash)
        private
        pure
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
