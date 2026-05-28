// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {FXBentoHook} from "../src/FXBentoHook.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {
    PoolId as FXPoolId,
    PoolKey as FXPoolKey,
    PoolIdLibrary as FXPoolIdLibrary
} from "../src/libraries/FXBentoTypes.sol";
import {IERC20, SafeERC20} from "../src/libraries/MinimalTokens.sol";

import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {
    PoolId as V4PoolId,
    PoolIdLibrary as V4PoolIdLibrary
} from "v4-core/types/PoolId.sol";
import {PoolKey as V4PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Minimal PoolManager.unlock helper for seeding live Bento v4 pools.
contract BentoV4LiquiditySeeder is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable manager;

    error NotPoolManager(address caller);

    struct SeedParams {
        address payer;
        address recipient;
        V4PoolKey key;
        IPoolManager.ModifyLiquidityParams params;
        bytes hookData;
    }

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function seed(
        address payer,
        address recipient,
        V4PoolKey memory key,
        IPoolManager.ModifyLiquidityParams memory params,
        bytes memory hookData
    ) external returns (BalanceDelta callerDelta, BalanceDelta feesAccrued) {
        return abi.decode(
            manager.unlock(
                abi.encode(
                    SeedParams({
                        payer: payer,
                        recipient: recipient,
                        key: key,
                        params: params,
                        hookData: hookData
                    })
                )
            ),
            (BalanceDelta, BalanceDelta)
        );
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotPoolManager(msg.sender);

        SeedParams memory data = abi.decode(rawData, (SeedParams));
        (BalanceDelta callerDelta, BalanceDelta feesAccrued) =
            manager.modifyLiquidity(data.key, data.params, data.hookData);

        _resolve(data.key.currency0, data.payer, data.recipient, callerDelta.amount0());
        _resolve(data.key.currency1, data.payer, data.recipient, callerDelta.amount1());

        return abi.encode(callerDelta, feesAccrued);
    }

    function _resolve(Currency currency, address payer, address recipient, int128 delta) internal {
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransferFrom(payer, address(manager), amount);
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, recipient, uint256(uint128(delta)));
        }
    }
}

/// @notice R4 defensive-audit remediation helper.
/// @dev Registers a Bento v4 pool, initializes it if needed, records a
///      snapshot if the pool was already initialized, then optionally adds
///      seed liquidity. No keeper flags or production envs are changed.
///
/// Required env:
///   KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY
///
/// Optional env:
///   BENTO_POOL_MANAGER
///   BENTO_POOL_REGISTRY
///   BENTO_HOOK
///   BENTO_TOKEN0
///   BENTO_TOKEN1
///   BENTO_TOKEN0_SOURCE
///   BENTO_TOKEN1_SOURCE
///   BENTO_TOKEN0_AMOUNT
///   BENTO_TOKEN1_AMOUNT
///   BENTO_V4_LIQUIDITY_DELTA
///   BENTO_FEE
///   BENTO_TICK_SPACING
///   BENTO_SQRT_PRICE_X96
///   BENTO_MAX_STALE_SECONDS
///   BENTO_ORACLE_SOURCE
contract SeedBentoV4Pool is Script {
    using FXPoolIdLibrary for FXPoolKey;
    using SafeERC20 for IERC20;
    using V4PoolIdLibrary for V4PoolKey;
    using StateLibrary for IPoolManager;

    uint256 internal constant ARC_CHAIN_ID = 5_042_002;
    uint256 internal constant FUJI_CHAIN_ID = 43_113;

    uint160 internal constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;
    int24 internal constant DEFAULT_TICK_LOWER = -887_220;
    int24 internal constant DEFAULT_TICK_UPPER = 887_220;

    address internal constant ARC_POOL_MANAGER = 0x3FA22b7Aeda9ebBe34732ea394f1711887363B34;
    address internal constant ARC_POOL_REGISTRY = 0xA9E3CD0414DaFFD78389e81465678B9feFD00155;
    address internal constant ARC_HOOK = 0x93EFEA7A2dfA566bcC5f2D5Befb993a08C6c10c0;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant ARC_EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    address internal constant FUJI_POOL_MANAGER = 0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C;
    address internal constant FUJI_POOL_REGISTRY = 0x4fb46362F6D89F15586c90aFB531Ccec7052E1aE;
    address internal constant FUJI_HOOK = 0x604320333c7f03C0Fc403EbF98Cf79fF0159d0c0;
    address internal constant FUJI_EURC = 0x50C4BA39CAA7f56152d0df4914e1F6b907194992;
    address internal constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;

    function run() external {
        uint256 pk = vm.envOr("KEEPER_PRIVATE_KEY", uint256(0));
        if (pk == 0) pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        require(pk != 0, "missing KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY");

        address broadcaster = vm.addr(pk);
        ChainDefaults memory defaults = _defaultsForChain();

        SeedConfig memory cfg = _loadConfig(defaults, broadcaster);

        require(cfg.token0 < cfg.token1, "BENTO_TOKEN0 must be sorted below BENTO_TOKEN1");
        require(cfg.tickSpacing > 0, "bad tick spacing");
        require(cfg.sqrtPriceX96 != 0, "bad sqrt price");

        V4PoolKey memory v4Key = V4PoolKey({
            currency0: Currency.wrap(cfg.token0),
            currency1: Currency.wrap(cfg.token1),
            fee: cfg.fee,
            tickSpacing: cfg.tickSpacing,
            hooks: IHooks(cfg.hook)
        });
        FXPoolKey memory fxKey = _fxKey(v4Key);
        FXPoolId fxPoolId = fxKey.toId();
        V4PoolId v4PoolId = v4Key.toId();

        console2.log("chainId        ", block.chainid);
        console2.log("broadcaster    ", broadcaster);
        console2.log("PoolManager    ", cfg.poolManager);
        console2.log("PoolRegistry   ", cfg.poolRegistry);
        console2.log("FXBentoHook    ", cfg.hook);
        console2.log("token0         ", cfg.token0);
        console2.log("token1         ", cfg.token1);
        console2.log("fxPoolId");
        console2.logBytes32(FXPoolId.unwrap(fxPoolId));
        console2.log("v4PoolId");
        console2.logBytes32(V4PoolId.unwrap(v4PoolId));

        vm.startBroadcast(pk);

        IPoolManager manager = _ensurePool(cfg, v4Key, fxKey, fxPoolId, v4PoolId);
        _seedLiquidity(cfg, v4Key, manager, broadcaster);

        vm.stopBroadcast();
    }

    function _ensurePool(
        SeedConfig memory cfg,
        V4PoolKey memory v4Key,
        FXPoolKey memory fxKey,
        FXPoolId fxPoolId,
        V4PoolId v4PoolId
    ) internal returns (IPoolManager manager) {
        PoolRegistry poolRegistry = PoolRegistry(cfg.poolRegistry);
        FXBentoHook bentoHook = FXBentoHook(cfg.hook);
        manager = IPoolManager(cfg.poolManager);

        if (!poolRegistry.isAllowed(fxPoolId)) {
            poolRegistry.setPool(fxKey, cfg.oracleSource, true, cfg.maxStaleSeconds);
            console2.log("registered pool in PoolRegistry");
        }

        if (!bentoHook.hookPoolAllowed(fxPoolId)) {
            bentoHook.setHookPoolAllowed(fxPoolId, true);
            console2.log("enabled hook pool");
        }

        (uint160 existingSqrtPrice, int24 existingTick,,) = manager.getSlot0(v4PoolId);
        if (existingSqrtPrice == 0) {
            int24 initializedTick = manager.initialize(v4Key, cfg.sqrtPriceX96);
            existingSqrtPrice = cfg.sqrtPriceX96;
            existingTick = initializedTick;
            console2.log("initialized v4 pool");
            console2.logInt(initializedTick);
        } else if (bentoHook.snapshotCount(fxPoolId) == 0) {
            bentoHook.recordSnapshotForTesting(fxKey, existingSqrtPrice, existingTick);
            console2.log("recorded snapshot for existing pool");
        }
    }

    function _seedLiquidity(
        SeedConfig memory cfg,
        V4PoolKey memory v4Key,
        IPoolManager manager,
        address broadcaster
    ) internal {
        if (cfg.liquidityDelta != 0) {
            require(cfg.liquidityDelta <= uint256(type(uint128).max), "liquidity delta too large");
            require(cfg.token0Cap != 0 && cfg.token1Cap != 0, "missing token caps");

            _pullIfNeeded(cfg.token0, cfg.token0Source, broadcaster, cfg.token0Cap);
            _pullIfNeeded(cfg.token1, cfg.token1Source, broadcaster, cfg.token1Cap);

            BentoV4LiquiditySeeder seeder = new BentoV4LiquiditySeeder(manager);
            _approve(cfg.token0, address(seeder), cfg.token0Cap);
            _approve(cfg.token1, address(seeder), cfg.token1Cap);

            (BalanceDelta callerDelta,) = seeder.seed(
                broadcaster,
                broadcaster,
                v4Key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: DEFAULT_TICK_LOWER,
                    tickUpper: DEFAULT_TICK_UPPER,
                    liquidityDelta: int256(cfg.liquidityDelta),
                    salt: bytes32(0)
                }),
                ""
            );

            _approve(cfg.token0, address(seeder), 0);
            _approve(cfg.token1, address(seeder), 0);

            console2.log("seeded v4 liquidity");
            console2.logInt(callerDelta.amount0());
            console2.logInt(callerDelta.amount1());
        }
    }

    struct ChainDefaults {
        address poolManager;
        address poolRegistry;
        address hook;
        address token0;
        address token1;
    }

    struct SeedConfig {
        address poolManager;
        address poolRegistry;
        address hook;
        address token0;
        address token1;
        uint24 fee;
        int24 tickSpacing;
        uint160 sqrtPriceX96;
        uint32 maxStaleSeconds;
        address oracleSource;
        uint256 liquidityDelta;
        uint256 token0Cap;
        uint256 token1Cap;
        address token0Source;
        address token1Source;
    }

    function _loadConfig(ChainDefaults memory defaults, address broadcaster)
        internal
        view
        returns (SeedConfig memory cfg)
    {
        cfg.poolManager = vm.envOr("BENTO_POOL_MANAGER", defaults.poolManager);
        cfg.poolRegistry = vm.envOr("BENTO_POOL_REGISTRY", defaults.poolRegistry);
        cfg.hook = vm.envOr("BENTO_HOOK", defaults.hook);
        cfg.token0 = vm.envOr("BENTO_TOKEN0", defaults.token0);
        cfg.token1 = vm.envOr("BENTO_TOKEN1", defaults.token1);
        cfg.fee = uint24(vm.envOr("BENTO_FEE", uint256(3_000)));
        cfg.tickSpacing = int24(int256(vm.envOr("BENTO_TICK_SPACING", uint256(60))));
        cfg.sqrtPriceX96 = uint160(vm.envOr("BENTO_SQRT_PRICE_X96", uint256(SQRT_PRICE_1_1)));
        cfg.maxStaleSeconds = uint32(vm.envOr("BENTO_MAX_STALE_SECONDS", uint256(3_600)));
        cfg.oracleSource = vm.envOr("BENTO_ORACLE_SOURCE", address(0));
        cfg.liquidityDelta = vm.envOr("BENTO_V4_LIQUIDITY_DELTA", uint256(0));
        cfg.token0Cap = vm.envOr("BENTO_TOKEN0_AMOUNT", uint256(0));
        cfg.token1Cap = vm.envOr("BENTO_TOKEN1_AMOUNT", uint256(0));
        cfg.token0Source = vm.envOr("BENTO_TOKEN0_SOURCE", broadcaster);
        cfg.token1Source = vm.envOr("BENTO_TOKEN1_SOURCE", broadcaster);
    }

    function _defaultsForChain() internal view returns (ChainDefaults memory defaults) {
        if (block.chainid == ARC_CHAIN_ID) {
            return ChainDefaults({
                poolManager: ARC_POOL_MANAGER,
                poolRegistry: ARC_POOL_REGISTRY,
                hook: ARC_HOOK,
                token0: ARC_USDC,
                token1: ARC_EURC
            });
        }
        if (block.chainid == FUJI_CHAIN_ID) {
            return ChainDefaults({
                poolManager: FUJI_POOL_MANAGER,
                poolRegistry: FUJI_POOL_REGISTRY,
                hook: FUJI_HOOK,
                token0: FUJI_EURC,
                token1: FUJI_USDC
            });
        }
        revert("unsupported chain");
    }

    function _fxKey(V4PoolKey memory key) internal pure returns (FXPoolKey memory) {
        return FXPoolKey({
            currency0: Currency.unwrap(key.currency0),
            currency1: Currency.unwrap(key.currency1),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: address(key.hooks)
        });
    }

    function _pullIfNeeded(address token, address source, address recipient, uint256 amount) internal {
        if (amount == 0 || source == recipient) return;
        IERC20(token).safeTransferFrom(source, recipient, amount);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        bool ok = IERC20(token).approve(spender, amount);
        require(ok, "approve failed");
    }
}
