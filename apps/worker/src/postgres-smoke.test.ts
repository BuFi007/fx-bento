import { describe, expect, test } from "bun:test";

import { createPonderReadSource } from "@bufinance/fx-bento-ponder";

import {
  configureFxBentoJobStore,
  enqueueFxBentoJob,
  getFxBentoJob,
  getFxBentoWorkerHealthSnapshot,
} from "./jobs";

const databaseUrl = firstEnv(
  "FX_BENTO_DATABASE_URL",
  "DATABASE_PRIVATE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "PRISMA_DATABASE_URL"
);
const ponderSqlUrl = firstEnv("PONDER_SQL_URL");
const shouldRun = process.env.FX_BENTO_RUN_DEPLOYED_SQL_SMOKE === "1";
const smoke = shouldRun ? test : test.skip;

describe("FX Bento deployed Postgres/Ponder SQL smoke", () => {
  smoke(
    "persists a worker job and checks remote Ponder health without clearing data",
    async () => {
      if (!databaseUrl) throw new Error("FX_BENTO_DATABASE_URL or DATABASE_URL is required for deployed worker SQL smoke");
      if (!ponderSqlUrl) throw new Error("PONDER_SQL_URL is required for deployed Ponder SQL smoke");

      configureFxBentoJobStore({ databaseUrl });
      const id = `smoke:${process.env.USER ?? "codex"}:${Date.now()}`;

      const created = await enqueueFxBentoJob({
        id,
        kind: "reconcile_room",
        chainId: Number(process.env.PONDER_CHAIN_ID ?? 84532),
        roomId: `smoke-${Date.now()}`,
        payload: { smoke: true, source: "apps/worker/src/postgres-smoke.test.ts" },
      });
      const persisted = await getFxBentoJob(created.id);
      const health = await getFxBentoWorkerHealthSnapshot();

      expect(persisted).toMatchObject({ id, kind: "reconcile_room", status: "queued" });
      expect(health.totalJobs).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(health.alerts)).toBe(true);

      const indexer = await createPonderReadSource({
        graphqlUrl: process.env.PONDER_GRAPHQL_URL,
        sqlUrl: ponderSqlUrl,
      }).health();
      if (process.env.PONDER_GRAPHQL_URL) {
        expect(indexer.status).toBe("remote");
        expect("ok" in indexer).toBe(true);
      } else {
        expect(indexer.status).toBe("sql");
        expect("ok" in indexer).toBe(true);
        expect("error" in indexer ? indexer.error : undefined).toBeUndefined();
      }
    },
    30_000
  );
});

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}
