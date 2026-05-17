// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FXBentoHook} from "../src/FXBentoHook.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {
    PoolId as FXPoolId,
    PoolKey as FXPoolKey,
    PoolIdLibrary as FXPoolIdLibrary
} from "../src/libraries/FXBentoTypes.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey as V4PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

contract FXBentoHookV4IntegrationTest is Test {
    using FXPoolIdLibrary for FXPoolKey;

    uint160 private constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    PoolManager private manager;
    PoolRegistry private registry;
    ProtocolFeeVault private vault;
    PoolModifyLiquidityTest private modifyLiquidityRouter;
    PoolSwapTest private swapRouter;
    MockUSDC private token0;
    MockUSDC private token1;

    function setUp() public {
        manager = new PoolManager(address(this));
        registry = new PoolRegistry(address(this));
        vault = new ProtocolFeeVault(address(this), address(0xFEE));
        modifyLiquidityRouter = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        swapRouter = new PoolSwapTest(IPoolManager(address(manager)));

        MockUSDC tokenA = new MockUSDC();
        MockUSDC tokenB = new MockUSDC();
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        token0.mint(address(this), 1_000_000_000e6);
        token1.mint(address(this), 1_000_000_000e6);
        token0.approve(address(modifyLiquidityRouter), type(uint256).max);
        token1.approve(address(modifyLiquidityRouter), type(uint256).max);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
    }

    function testMinedHookAddressMatchesV4PermissionBits() public {
        FXBentoHook hook = _deployHookAtPermissionedAddress();

        assertEq(hook.hookPermissionBitmap(), _permissionBitmap());
        assertTrue(hook.hookAddressHasPermissions(address(hook)));
    }

    function testRealPoolManagerInitializeAndSwapRecordSnapshots() public {
        FXBentoHook hook = _deployHookAtPermissionedAddress();
        V4PoolKey memory key = _poolKey(hook);
        FXPoolKey memory fxKey = _fxPoolKey(key);
        FXPoolId poolId = fxKey.toId();

        registry.setPool(fxKey, address(0x0A11CE), true, 300);

        manager.initialize(key, SQRT_PRICE_1_1);
        assertEq(hook.snapshotCount(poolId), 1);

        modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e12, salt: 0}),
            ""
        );

        BalanceDelta delta = swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -1_000e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        assertLt(delta.amount0(), 0);
        assertGt(delta.amount1(), 0);
        assertEq(hook.snapshotCount(poolId), 2);
        assertEq(hook.latestSnapshot(poolId).timestamp, uint64(block.timestamp));
    }

    function _deployHookAtPermissionedAddress() private returns (FXBentoHook hook) {
        address hookAddress = address(uint160(_permissionBitmap()));
        deployCodeTo(
            "FXBentoHook.sol:FXBentoHook",
            abi.encode(address(this), IPoolManager(address(manager)), registry, vault),
            hookAddress
        );
        hook = FXBentoHook(hookAddress);
    }

    function _permissionBitmap() private pure returns (uint160) {
        return Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    }

    function _poolKey(FXBentoHook hook) private view returns (V4PoolKey memory) {
        return V4PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });
    }

    function _fxPoolKey(V4PoolKey memory key) private pure returns (FXPoolKey memory) {
        return FXPoolKey({
            currency0: Currency.unwrap(key.currency0),
            currency1: Currency.unwrap(key.currency1),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: address(key.hooks)
        });
    }
}
