import {
  FX_BENTO_EVENT_NAMES_BY_CONTRACT,
  type ContractName,
  type FxBentoContractEventName,
} from "@bufinance/fx-bento-contracts";
import { recordFxBentoContractEvent } from "@bufinance/fx-bento-ponder";
import { ponder } from "ponder:registry";
import * as schema from "ponder:schema";

const registry = ponder as unknown as {
  on: (
    eventName: string,
    handler: (args: { event: PonderEvent; context: PonderContext }) => Promise<void> | void
  ) => void;
};

type PonderEvent = {
  args: Record<string, unknown>;
  transaction: { hash: `0x${string}` };
  log: { logIndex: number };
  block: { number: bigint; timestamp?: bigint };
};

type PonderContext = {
  db: {
    insert: (table: unknown) => {
      values: (value: Record<string, unknown>) => {
        onConflictDoUpdate: (value: Record<string, unknown>) => Promise<unknown>;
        onConflictDoNothing: () => Promise<unknown>;
      };
    };
  };
};

for (const [contractName, eventNames] of Object.entries(FX_BENTO_EVENT_NAMES_BY_CONTRACT)) {
  for (const eventName of eventNames) {
    registerFxBentoEvent(contractName as ContractName, eventName as FxBentoContractEventName);
  }
}

function registerFxBentoEvent(contractName: ContractName, eventName: FxBentoContractEventName): void {
  registry.on(`${contractName}:${eventName}`, async ({ event, context }) => {
    const indexed = recordFxBentoContractEvent({
      chainId: Number(process.env.PONDER_CHAIN_ID ?? 84532),
      contractName,
      eventName,
      args: event.args,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    });
    await writeIndexedEvent(context, indexed, event);
    await writeReadProjection(context, indexed, event);
  });
}

async function writeIndexedEvent(
  context: PonderContext,
  indexed: ReturnType<typeof recordFxBentoContractEvent>,
  event: PonderEvent
) {
  const timestamp = event.block.timestamp ?? 0n;
  const amount =
    bigintArg(event.args.amount) ??
    bigintArg(event.args.entryFee) ??
    bigintArg(event.args.escrowed) ??
    bigintArg(event.args.protocolFee);
  await context.db
    .insert(schema.fxBentoEvent)
    .values({
      id: indexed.id,
      chainId: indexed.chainId,
      contractName: indexed.contractName ?? "",
      eventName: indexed.eventName ?? "",
      roomId: indexed.roomId ?? null,
      poolId: indexed.poolId ?? null,
      player: indexed.wallet ?? null,
      kind: indexed.kind,
      amount: amount ?? null,
      txHash: indexed.txHash,
      blockNumber: indexed.blockNumber,
      timestamp,
    })
    .onConflictDoUpdate({
      kind: indexed.kind,
      amount: amount ?? null,
      blockNumber: indexed.blockNumber,
      timestamp,
    });
}

async function writeReadProjection(
  context: PonderContext,
  indexed: ReturnType<typeof recordFxBentoContractEvent>,
  event: PonderEvent
) {
  const timestamp = event.block.timestamp ?? 0n;
  if (indexed.roomId) {
    await writeRoomProjection(context, indexed, event, timestamp);
  }
  if (indexed.kind === "fxBento.marketSnapshot" && indexed.poolId) {
    await context.db
      .insert(schema.fxBentoMarketSnapshot)
      .values({
        id: indexed.id,
        chainId: indexed.chainId,
        poolId: indexed.poolId,
        sqrtPriceX96: bigintArg(event.args.sqrtPriceX96) ?? 0n,
        tick: Number(event.args.tick ?? 0),
        timestamp: bigintArg(event.args.timestamp) ?? timestamp,
        volatility: bigintArg(event.args.volatility) ?? 0n,
        txHash: indexed.txHash,
        blockNumber: indexed.blockNumber,
      })
      .onConflictDoUpdate({
        sqrtPriceX96: bigintArg(event.args.sqrtPriceX96) ?? 0n,
        tick: Number(event.args.tick ?? 0),
        timestamp: bigintArg(event.args.timestamp) ?? timestamp,
        volatility: bigintArg(event.args.volatility) ?? 0n,
        txHash: indexed.txHash,
        blockNumber: indexed.blockNumber,
      });
  }
}

async function writeRoomProjection(
  context: PonderContext,
  indexed: ReturnType<typeof recordFxBentoContractEvent>,
  event: PonderEvent,
  timestamp: bigint
) {
  const id = `${indexed.chainId}:${indexed.roomId}`;
  const status = statusFromEvent(indexed.eventName, event.args.status);
  await context.db
    .insert(schema.fxBentoRoom)
    .values({
      id,
      chainId: indexed.chainId,
      roomId: indexed.roomId,
      poolId: indexed.poolId ?? hexArg(event.args.poolId),
      entryToken: hexArg(event.args.entryToken),
      entryFee: bigintArg(event.args.entryFee),
      marketId: null,
      status: status ?? "unknown",
      playerCount: indexed.kind === "fxBento.playerJoined" ? 1 : 0,
      escrowedAmount: bigintArg(event.args.escrowed) ?? 0n,
      protocolFee: bigintArg(event.args.protocolFee),
      settlementRoot: hexArg(event.args.resultsRoot),
      resultsMetadataUri: stringArg(event.args.metadataURI),
      resultsChallenged: indexed.kind === "fxBento.resultsChallenged",
      resultsFinalized: indexed.kind === "fxBento.resultsFinalized",
      createdAt: indexed.kind === "fxBento.roomCreated" ? timestamp : null,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate(compact({
      poolId: indexed.poolId ?? hexArg(event.args.poolId),
      entryToken: hexArg(event.args.entryToken),
      entryFee: bigintArg(event.args.entryFee),
      status,
      playerCount: indexed.kind === "fxBento.playerJoined" ? 1 : undefined,
      escrowedAmount: bigintArg(event.args.escrowed) ?? undefined,
      protocolFee: bigintArg(event.args.protocolFee),
      settlementRoot: hexArg(event.args.resultsRoot),
      resultsMetadataUri: stringArg(event.args.metadataURI),
      resultsChallenged: indexed.kind === "fxBento.resultsChallenged" ? true : undefined,
      resultsFinalized: indexed.kind === "fxBento.resultsFinalized" ? true : undefined,
      updatedAt: timestamp,
    }));

  if (indexed.wallet) {
    const playerStatus = playerStatusFromEvent(indexed.eventName);
    await context.db
      .insert(schema.fxBentoRoomPlayer)
      .values({
        id: `${id}:${indexed.wallet.toLowerCase()}`,
        chainId: indexed.chainId,
        roomId: indexed.roomId,
        player: indexed.wallet,
        status: playerStatus ?? "joined",
        joinedAt: indexed.kind === "fxBento.playerJoined" ? timestamp : null,
        leftAt: indexed.kind === "fxBento.playerLeft" ? timestamp : null,
        refundedAt: indexed.kind === "fxBento.refundClaimed" ? timestamp : null,
        prizeClaimedAmount: bigintArg(event.args.amount),
        updatedAt: timestamp,
      })
      .onConflictDoUpdate(compact({
        status: playerStatus,
        leftAt: indexed.kind === "fxBento.playerLeft" ? timestamp : undefined,
        refundedAt: indexed.kind === "fxBento.refundClaimed" ? timestamp : undefined,
        prizeClaimedAmount: bigintArg(event.args.amount),
        updatedAt: timestamp,
      }));
  }

  if (indexed.roundIndex !== undefined) {
    await context.db
      .insert(schema.fxBentoRound)
      .values({
        id: `${id}:${indexed.roundIndex}`,
        chainId: indexed.chainId,
        roomId: indexed.roomId,
        roundIndex: indexed.roundIndex,
        status: indexed.kind === "fxBento.settlementRecorded" ? "settled" : "active",
        startTime: bigintArg(event.args.startTime),
        lockTime: bigintArg(event.args.lockTime),
        endTime: bigintArg(event.args.endTime),
        anchorPrice: indexed.kind === "fxBento.anchorRecorded" ? bigintArg(event.args.price) : null,
        settlementPrice: indexed.kind === "fxBento.settlementRecorded" ? bigintArg(event.args.price) : null,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate(compact({
        status: indexed.kind === "fxBento.settlementRecorded" ? "settled" : undefined,
        startTime: bigintArg(event.args.startTime),
        lockTime: bigintArg(event.args.lockTime),
        endTime: bigintArg(event.args.endTime),
        anchorPrice: indexed.kind === "fxBento.anchorRecorded" ? bigintArg(event.args.price) : undefined,
        settlementPrice: indexed.kind === "fxBento.settlementRecorded" ? bigintArg(event.args.price) : undefined,
        updatedAt: timestamp,
      }));
  }
}

function statusFromEvent(eventName: string | undefined, status: unknown): string | undefined {
  if (eventName === "RoomCreated") return "lobby";
  if (eventName === "RoomLocked") return "active";
  if (eventName === "RoomCancelled") return "cancelled";
  if (eventName === "RoomSettled") return "settled";
  if (eventName === "ResultsSubmitted") return "settling";
  if (eventName === "RoomStatusUpdated") {
    const statusId = Number(status);
    return ({ 0: "lobby", 1: "active", 2: "settling", 3: "settled", 4: "cancelled" } as Record<number, string>)[
      statusId
    ];
  }
  return undefined;
}

function playerStatusFromEvent(eventName: string | undefined): string | undefined {
  if (eventName === "RoomJoined") return "joined";
  if (eventName === "RoomLeft") return "left";
  if (eventName === "Refunded") return "refunded";
  return undefined;
}

function bigintArg(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function hexArg(value: unknown): `0x${string}` | null {
  return typeof value === "string" && value.startsWith("0x") ? (value as `0x${string}`) : null;
}

function stringArg(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
