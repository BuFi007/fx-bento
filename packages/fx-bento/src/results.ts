import {
  createFxBentoMemoryPersistenceStore,
  createFxBentoPostgresPersistenceStore,
  createFxBentoSqlitePersistenceStore,
  type FxBentoPersistenceStore,
} from "@bufinance/fx-bento-db";
import { AddressSchema, HexSchema, nowIso } from "@bufinance/fx-bento-shared-types";
import { z } from "zod";

const DecimalStringSchema = z.string().regex(/^\d+$/);

export const FxBentoSettlementAllocationSchema = z.object({
  player: AddressSchema,
  amount: DecimalStringSchema,
  score: DecimalStringSchema.default("0"),
  rank: z.coerce.number().int().positive(),
  leaf: HexSchema,
  proof: z.array(HexSchema),
});

export const FxBentoSettlementResultSchema = z.object({
  id: z.string().min(1),
  chainId: z.coerce.number().int().positive(),
  roomId: z.string().min(1),
  status: z.enum(["built", "submitted", "finalized", "challenged"]).default("built"),
  resultsRoot: HexSchema,
  metadataURI: z.string().min(1).optional(),
  totalPrizePayouts: DecimalStringSchema,
  protocolFee: DecimalStringSchema.default("0"),
  submitTxHash: HexSchema.optional(),
  finalizationTxHash: HexSchema.optional(),
  finalizedAt: z.string().datetime().optional(),
  finalizedBlockNumber: DecimalStringSchema.optional(),
  allocations: z.array(FxBentoSettlementAllocationSchema),
  createdAt: z.string().datetime().default(nowIso),
  updatedAt: z.string().datetime().default(nowIso),
});

export type FxBentoSettlementAllocation = z.infer<typeof FxBentoSettlementAllocationSchema>;
export type FxBentoSettlementResult = z.infer<typeof FxBentoSettlementResultSchema>;

let store: FxBentoPersistenceStore = createFxBentoMemoryPersistenceStore();

export function configureFxBentoSettlementResultStore(
  args: {
    databaseUrl?: string | null;
    dbPath?: string | null;
    store?: FxBentoPersistenceStore | null;
    filePath?: string | null;
  } = {}
): void {
  if (args.store) {
    store = args.store;
    return;
  }
  const dbPath = args.dbPath ?? args.filePath;
  store = args.databaseUrl
    ? createFxBentoPostgresPersistenceStore(args.databaseUrl)
    : dbPath
      ? createFxBentoSqlitePersistenceStore(dbPath)
      : createFxBentoMemoryPersistenceStore();
}

export async function saveFxBentoSettlementResult(
  input: Omit<z.input<typeof FxBentoSettlementResultSchema>, "id"> & { id?: string }
): Promise<FxBentoSettlementResult> {
  const now = nowIso();
  const id = input.id ?? settlementResultId(Number(input.chainId), String(input.roomId));
  const existing = await store.getSettlementResult(id);
  const parsed = FxBentoSettlementResultSchema.parse({
    ...existing,
    ...input,
    id,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  });
  return FxBentoSettlementResultSchema.parse(await store.saveSettlementResult(parsed));
}

export async function recordFxBentoSettlementFinalization(input: {
  chainId: number;
  roomId: string;
  txHash: `0x${string}`;
  blockNumber?: bigint | number | string;
  finalizedAt?: string;
}): Promise<FxBentoSettlementResult> {
  const id = settlementResultId(input.chainId, input.roomId);
  const existing = await store.getSettlementResult(id);
  if (!existing) throw new Error("settlement_result_not_found");
  return await saveFxBentoSettlementResult({
    ...existing,
    status: "finalized",
    finalizationTxHash: input.txHash,
    finalizedAt: input.finalizedAt ?? nowIso(),
    finalizedBlockNumber:
      input.blockNumber === undefined ? existing.finalizedBlockNumber : String(input.blockNumber),
  });
}

export async function getFxBentoSettlementResult(args: {
  chainId?: number;
  roomId: string;
}): Promise<FxBentoSettlementResult | null> {
  const result = args.chainId
    ? await store.getSettlementResult(settlementResultId(args.chainId, args.roomId))
    : (await store.listSettlementResults()).find((item) => item.roomId === args.roomId);
  return result ? FxBentoSettlementResultSchema.parse(result) : null;
}

export async function getFxBentoClaimProof(args: {
  chainId?: number;
  roomId: string;
  player: string;
}): Promise<{
  roomId: string;
  player: `0x${string}`;
  amount: string;
  proof: `0x${string}`[];
  leaf: `0x${string}`;
  settlementRoot: `0x${string}`;
  proofReady: boolean;
  finalized: boolean;
} | null> {
  const result = await getFxBentoSettlementResult({ chainId: args.chainId, roomId: args.roomId });
  if (!result) return null;
  const player = AddressSchema.parse(args.player);
  const allocation = result.allocations.find((item) => item.player.toLowerCase() === player.toLowerCase());
  if (!allocation) return null;
  return {
    roomId: result.roomId,
    player,
    amount: allocation.amount,
    proof: allocation.proof,
    leaf: allocation.leaf,
    settlementRoot: result.resultsRoot,
    proofReady: true,
    finalized: result.status === "finalized",
  };
}

export async function listFxBentoSettlementResults(): Promise<FxBentoSettlementResult[]> {
  return (await store.listSettlementResults()).map((result) => FxBentoSettlementResultSchema.parse(result));
}

export async function resetFxBentoSettlementResultsForTests(): Promise<void> {
  await store.clearSettlementResults();
}

function settlementResultId(chainId: number, roomId: string): string {
  return `${chainId}:${roomId}`;
}
