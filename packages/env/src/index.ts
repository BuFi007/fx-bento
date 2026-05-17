import { z } from "zod";

const optionalAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .optional();

export const FxBentoEnvSchema = z.object({
  API_SECRET_KEY: z.string().min(16).optional(),
  API_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  CONTRACT_ADDRESSES_JSON: z.string().optional(),
  CONTRACT_RPC_URL: z.string().url().optional(),
  ENVIRONMENT: z.enum(["development", "preview", "staging", "production", "test"]).default("development"),
  FX_BENTO_DB_PATH: z.string().min(1).optional(),
  FX_BENTO_DATABASE_URL: z.string().url().optional(),
  LIVEBLOCKS_SECRET_KEY: z.string().min(1).optional(),
  MARKET_DATA_RPC_URL: z.string().url().optional(),
  NODE_ENV: z.string().optional(),
  OPERATOR_ALERT_DEDUP_SECONDS: z.coerce.number().int().positive().default(900),
  OPERATOR_ALERT_MIN_SEVERITY: z.enum(["warning", "critical"]).default("warning"),
  OPERATOR_ALERT_WEBHOOK_URL: z.string().url().optional(),
  PONDER_GRAPHQL_URL: z.string().url().optional(),
  PONDER_RPC_URL: z.string().url().optional(),
  PONDER_SQL_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(8787),
  SIMULATION_ACCOUNT_ADDRESS: optionalAddress,
  SETTLEMENT_RESULT_STORE_PATH: z.string().min(1).optional(),
  TREASURY_ADDRESS: optionalAddress,
  WORKER_JOB_STORE_PATH: z.string().min(1).optional(),
  WORKER_PORT: z.coerce.number().int().positive().default(8788),
  WORKER_STUCK_JOB_SECONDS: z.coerce.number().int().positive().default(600),
  X402_NETWORK: z.string().min(1).default("eip155:84532"),
  X402_RECEIVER_ADDRESS: optionalAddress,
  X402_VERIFIER_URL: z.string().url().optional(),
});

export type FxBentoEnv = z.infer<typeof FxBentoEnvSchema>;

export function readEnv(source: Record<string, string | undefined> = process.env): FxBentoEnv {
  return FxBentoEnvSchema.parse(source);
}

export function readEnvSafe(source: Record<string, string | undefined> = process.env) {
  return FxBentoEnvSchema.safeParse(source);
}

export const REQUIRED_RUNTIME_ENV = [
  "LIVEBLOCKS_SECRET_KEY",
  "X402_RECEIVER_ADDRESS",
  "TREASURY_ADDRESS",
] as const;

export function missingRuntimeEnv(env: FxBentoEnv): string[] {
  return REQUIRED_RUNTIME_ENV.filter((key) => !env[key]);
}
