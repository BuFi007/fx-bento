import {
  createFxBentoMemoryPersistenceStore,
  createFxBentoPostgresPersistenceStore,
  createFxBentoSqlitePersistenceStore,
  type FxBentoPersistenceStore,
  type FxBentoStoredX402Receipt,
} from "@bufinance/fx-bento-db";
import { nowIso } from "@bufinance/fx-bento-shared-types";

import { X402ReceiptSchema, type X402Receipt } from "./types";

let store: FxBentoPersistenceStore = createFxBentoMemoryPersistenceStore();

export function configureX402ReceiptStore(
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

export async function saveReceipt(receipt: X402Receipt): Promise<X402Receipt> {
  const parsed = X402ReceiptSchema.parse({
    ...receipt,
    status: receipt.status ?? "verified",
    metadata: receipt.metadata ?? {},
    updatedAt: receipt.updatedAt ?? nowIso(),
  });
  const stored = await store.saveX402Receipt(toStoredReceipt(parsed));
  return fromStoredReceipt(stored);
}

export async function getReceipt(id: string): Promise<X402Receipt | null> {
  const receipt = await store.getX402Receipt(id);
  return receipt ? fromStoredReceipt(receipt) : null;
}

export async function listReceipts(): Promise<X402Receipt[]> {
  return (await store.listX402Receipts()).map(fromStoredReceipt);
}

export async function clearReceipts(): Promise<void> {
  await store.clearX402Receipts();
}

function toStoredReceipt(receipt: X402Receipt): FxBentoStoredX402Receipt {
  return {
    id: receipt.id,
    payer: receipt.payer,
    amount: receipt.amount,
    network: receipt.network,
    settlementRef: receipt.settlementRef,
    toolName: receipt.toolName,
    requestMethod: receipt.requestMethod,
    requestPath: receipt.requestPath,
    status: receipt.status,
    metadata: receipt.metadata ?? {},
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
  };
}

function fromStoredReceipt(receipt: FxBentoStoredX402Receipt): X402Receipt {
  return X402ReceiptSchema.parse({
    id: receipt.id,
    payer: receipt.payer,
    amount: receipt.amount,
    network: receipt.network,
    settlementRef: receipt.settlementRef,
    toolName: receipt.toolName,
    requestMethod: receipt.requestMethod,
    requestPath: receipt.requestPath,
    status: receipt.status ?? "verified",
    metadata: receipt.metadata ?? {},
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt ?? receipt.createdAt,
  });
}
