// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FXBentoHook} from "../src/FXBentoHook.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

contract MineFXBentoHookSalt is Script {
    uint160 private constant REQUIRED_PERMISSIONS =
        Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    function run() external view {
        address deployer = vm.envOr("CREATE2_DEPLOYER", msg.sender);
        address owner = vm.envOr("OWNER", msg.sender);
        address poolManager = vm.envAddress("POOL_MANAGER");
        address registry = vm.envAddress("POOL_REGISTRY");
        address vault = vm.envAddress("PROTOCOL_FEE_VAULT");
        uint256 attempts = vm.envOr("HOOK_MINE_ATTEMPTS", uint256(5_000_000));

        bytes memory initCode = abi.encodePacked(
            type(FXBentoHook).creationCode,
            abi.encode(owner, IPoolManager(poolManager), PoolRegistry(registry), ProtocolFeeVault(vault))
        );
        bytes32 initCodeHash = keccak256(initCode);

        for (uint256 i; i < attempts; i++) {
            bytes32 salt = bytes32(i);
            address predicted = _computeCreate2Address(deployer, salt, initCodeHash);
            if (_hasRequiredPermissions(predicted)) {
                console2.log("FXBentoHook CREATE2 deployer", deployer);
                console2.log("FXBentoHook predicted address", predicted);
                console2.logBytes32(salt);
                return;
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

    function _hasRequiredPermissions(address hook) private pure returns (bool) {
        return uint160(hook) & Hooks.ALL_HOOK_MASK == REQUIRED_PERMISSIONS;
    }
}
