# FX² Arcade Protocol

Solidity protocol contracts for **FX² Arcade Protocol** and its first game, **FX Bento**.

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

This repository is the protocol repo. It should stay focused on Foundry contracts, deployment scripts, protocol tests, invariants, and security documentation. App, backend, indexer, Liveblocks, and frontend work belongs in separate repositories.

## Thesis

FX² Arcade Protocol is a decentralized multiplayer arcade layer for FX markets. FX Bento is the first game: players enter USDC rooms, compete on future price-tile predictions using equal chip budgets, and win from capped player-funded prize pools. Uniswap v4 hooks anchor the game to real market pools, while escrow contracts guarantee that no player or admin can withdraw room funds outside the rules. The protocol earns transparent rake and never takes uncapped directional risk.

## Protocol Boundary

- `FXBentoHook.sol`: Uniswap v4 market snapshot hook. It caches allowed pools after initialization, records indexed PoolManager snapshots, exposes market observations, emits settlement/indexer events, and never custodies player escrow.
- `FXBentoRoomFactory.sol`: creates immutable FX Bento room configs.
- `FXBentoRoomEscrow.sol`: holds entry fees, refunds cancelled rooms, stores typed payout-root metadata, settles Merkle prize roots, and enforces `payouts + rake <= escrow`.
- `FXBentoRoundManager.sol`: stores round timing, fresh anchor snapshot ids, and settlement snapshot ids.
- `FXBentoCommitmentManager.sol`: commit-reveal tile selections with optional batched commitments.
- `FXBentoScoring.sol`: pure anti-wall validation and fixed-point hit scoring.
- `FXBentoSettlementManager.sol`: MVP attestor/challenge/finalize flow with typed payout validation and timeout rescue.
- `PoolRegistry.sol`: allowed FX pool registry.
- `ProtocolFeeVault.sol`: receives protocol rake.

The hook is the market integration layer, not the game engine. Escrow, commit-reveal, scoring, settlement, refunds, and prize distribution remain isolated contracts.

## Commands

```bash
git submodule update --init --recursive
forge fmt --check
forge build
forge test
forge script script/PlanFXBentoDeployment.s.sol --sig "run()"
```

If using the convenience npm scripts:

```bash
npm run verify
```

## Live Testnet Deployments

Deployments use `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69` as deployer, owner, and treasury.
The v4 `PoolManager` was deployed by this repo on both testnets because no canonical target address was configured locally for these deployments.

### Arc Testnet

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Indexer start block: `42625070`
- PoolManager: `0x3FA22b7Aeda9ebBe34732ea394f1711887363B34`
- PoolRegistry: `0x4d17c86866e6f0eab4908fe4cb4592e56e361084`
- ProtocolFeeVault: `0x468c241484f6aa6bd9555c9533074510dc7d6df1`
- FXBentoHook: `0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0`
- FXBentoRoomFactory: `0x385bbd57d0dc2008e4446af7b12dcd158d56034d`
- FXBentoRoomEscrow: `0xab2f146507854334464c4b2326654775d9d947ed`
- FXBentoRoundManager: `0xfb956d033b15276da21579afd5f5b6bf6320869e`
- FXBentoSettlementManager: `0x8f635571aaea4b1391534cd92932caa839e04bcd`
- FXBentoCommitmentManager: `0x6b2c047fa0deb963a9ede1db7d0e4df258880414`
- PoolManager tx: `0xe530576aaa0474fee5bae904e7dc64fc7ca1caf60d4dedbf57abc655d5747755`

Backend/indexer env:

```bash
FX_BENTO_RPC_URL=https://rpc.testnet.arc.network
FX_BENTO_CHAIN_ID=5042002
FX_BENTO_FROM_BLOCK=42625070
FX_BENTO_FACTORY_ADDRESS=0x385bbd57d0dc2008e4446af7b12dcd158d56034d
FX_BENTO_ESCROW_ADDRESS=0xab2f146507854334464c4b2326654775d9d947ed
FX_BENTO_SETTLEMENT_ADDRESS=0x8f635571aaea4b1391534cd92932caa839e04bcd
```

### Avalanche Fuji

- Chain ID: `43113`
- RPC: `https://api.avax-test.network/ext/bc/C/rpc`
- Indexer start block: `55454938`
- PoolManager: `0x44B50E93eCC7775aF99bcd04c30e1A00da80F63C`
- PoolRegistry: `0x2931c50745334d6dff9ec4e3106fe05b49717df1`
- ProtocolFeeVault: `0x7ac83373c6b74c7c5b0eee80fb36239a451dc899`
- FXBentoHook: `0x4959be2392a8a2ac27060c26c8f7d070ada9d0c0`
- FXBentoRoomFactory: `0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1`
- FXBentoRoomEscrow: `0x5d10d2c3b9951054845534b2f60a68ebc0898cd3`
- FXBentoRoundManager: `0x27dbda42adb904115cade37c949bbf670e0ff09d`
- FXBentoSettlementManager: `0xa73208b62af9a87fb5e2b694b27f510d70e17746`
- FXBentoCommitmentManager: `0xaad184861726627968718fde8b94ecac87eb5c5b`
- PoolManager tx: `0x5002bbd6105487376c6f465002b8839d96f3884e98e52c405160b908b3ff0f6b`

Backend/indexer env:

```bash
FX_BENTO_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
FX_BENTO_CHAIN_ID=43113
FX_BENTO_FROM_BLOCK=55454938
FX_BENTO_FACTORY_ADDRESS=0xc7ade54428d51b5d0ceb42e7dd5a47d48515ace1
FX_BENTO_ESCROW_ADDRESS=0x5d10d2c3b9951054845534b2f60a68ebc0898cd3
FX_BENTO_SETTLEMENT_ADDRESS=0xa73208b62af9a87fb5e2b694b27f510d70e17746
```

Post-deploy checks performed on both networks:

- `FXBentoHook.hookAddressHasPermissions(hook) == true`
- `FXBentoHook.poolManager()` matches the deployed `PoolManager`
- `FXBentoRoomFactory.escrow()` matches `FXBentoRoomEscrow`
- `ProtocolFeeVault.feeNotifier()` matches `FXBentoRoomEscrow`
- `FXBentoRoomEscrow.settlementManager()` matches `FXBentoSettlementManager`
- `FXBentoSettlementManager.roundManager()` matches `FXBentoRoundManager`

## Current Coverage

Foundry coverage includes:

- room creation and invalid config rejection
- joins, leaves, max-player limits, and min-player lock checks
- cancellation, refunds, failed start, and rescue paths
- paid active membership checks for commit/reveal and prize eligibility
- commit-reveal mismatch, late commit, wall-pattern, and tile-limit rejection
- scoring hit/miss and coverage penalty paths
- v4 hook permission-bit validation and real PoolManager snapshot integration
- fresh/stale round anchor and settlement snapshot binding
- typed payout root validation
- challenge acceptance/rejection/finalization
- rake, prize claims, double-claim, and double-settlement prevention
- lifecycle accounting invariants for escrow, prize claims, protocol fees, and token conservation

## Documentation

- `AGENTS.md`: protocol architecture guidance for agents.
- `docs/architecture-reference.md`: validation-first protocol architecture.
- `docs/hook-deployment.md`: v4 permission-bit and hook deployment notes.
- `docs/p0-validation-qa.md`: room-first QA matrix.
- `docs/payout-root-schema.md`: strict settlement payout payload schema.
- `docs/room-lifecycle.md`: room lifecycle and state transitions.
- `docs/threat-model.md`: trust boundaries and limitations.
- `TODOS.md`: protocol implementation queue.
