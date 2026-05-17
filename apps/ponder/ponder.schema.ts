import { index, onchainTable } from "ponder";

export const fxBentoRoom = onchainTable(
  "fx_bento_room",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    roomId: t.text().notNull(),
    poolId: t.hex(),
    entryToken: t.hex(),
    entryFee: t.bigint(),
    marketId: t.text(),
    status: t.text().notNull(),
    playerCount: t.integer().notNull().default(0),
    escrowedAmount: t.bigint().notNull().default(0n),
    protocolFee: t.bigint(),
    settlementRoot: t.hex(),
    resultsMetadataUri: t.text(),
    resultsChallenged: t.boolean().notNull().default(false),
    resultsFinalized: t.boolean().notNull().default(false),
    createdAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    byChainRoom: index().on(t.chainId, t.roomId),
    byPool: index().on(t.poolId),
    byMarket: index().on(t.marketId),
    byStatus: index().on(t.status),
  })
);

export const fxBentoRoomPlayer = onchainTable(
  "fx_bento_room_player",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    roomId: t.text().notNull(),
    player: t.hex().notNull(),
    status: t.text().notNull(),
    joinedAt: t.bigint(),
    leftAt: t.bigint(),
    refundedAt: t.bigint(),
    prizeClaimedAmount: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    byRoom: index().on(t.chainId, t.roomId),
    byPlayer: index().on(t.player),
    byStatus: index().on(t.status),
  })
);

export const fxBentoRound = onchainTable(
  "fx_bento_round",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    roomId: t.text().notNull(),
    roundIndex: t.integer().notNull(),
    status: t.text().notNull(),
    startTime: t.bigint(),
    lockTime: t.bigint(),
    endTime: t.bigint(),
    anchorPrice: t.bigint(),
    settlementPrice: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    byRoom: index().on(t.chainId, t.roomId),
    byRound: index().on(t.chainId, t.roomId, t.roundIndex),
    byStatus: index().on(t.status),
  })
);

export const fxBentoCommitment = onchainTable(
  "fx_bento_commitment",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    roomId: t.text().notNull(),
    roundIndex: t.integer().notNull(),
    player: t.hex().notNull(),
    commitment: t.hex().notNull(),
    selectedTilesHash: t.hex(),
    committedTxHash: t.hex(),
    revealedTxHash: t.hex(),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    byRoom: index().on(t.chainId, t.roomId),
    byPlayer: index().on(t.player),
  })
);

export const fxBentoMarketSnapshot = onchainTable(
  "fx_bento_market_snapshot",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    poolId: t.hex().notNull(),
    sqrtPriceX96: t.bigint().notNull(),
    tick: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    volatility: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
  }),
  (t) => ({
    byPool: index().on(t.chainId, t.poolId),
    byTimestamp: index().on(t.timestamp),
  })
);

export const fxBentoEvent = onchainTable(
  "fx_bento_event",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    contractName: t.text().notNull(),
    eventName: t.text().notNull(),
    roomId: t.text(),
    poolId: t.hex(),
    player: t.hex(),
    kind: t.text().notNull(),
    amount: t.bigint(),
    txHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (t) => ({
    byRoom: index().on(t.chainId, t.roomId),
    byPool: index().on(t.chainId, t.poolId),
    byPlayer: index().on(t.player),
    byKind: index().on(t.kind),
  })
);

export const perpsPosition = onchainTable(
  "perps_position",
  (t) => ({
    id: t.text().primaryKey(),
    wallet: t.hex().notNull(),
    marketId: t.text().notNull(),
    side: t.text().notNull(),
    notionalUsd: t.bigint().notNull(),
    marginUsd: t.bigint().notNull(),
    status: t.text().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    byWallet: index().on(t.wallet),
    byMarket: index().on(t.marketId),
  })
);

export const fxTelaranaPosition = onchainTable(
  "fx_telarana_position",
  (t) => ({
    id: t.text().primaryKey(),
    wallet: t.hex().notNull(),
    marketId: t.text().notNull(),
    collateralAmount: t.bigint().notNull(),
    debtAmount: t.bigint().notNull(),
    status: t.text().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    byWallet: index().on(t.wallet),
    byMarket: index().on(t.marketId),
  })
);
