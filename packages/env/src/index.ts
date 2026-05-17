import { z } from "zod";

function emptyToUndefined(value: unknown) {
  return value === "" ? undefined : value;
}

const optionalAddress = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional()
);
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalPositiveInt = z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional());
const optionalNonnegativeInt = z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional());

export const FxBentoEnvSchema = z.object({
  API_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  API_SIGNER_PRIVATE_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional()
  ),
  CONTRACT_ADDRESSES_JSON: optionalNonEmptyString,
  CONTRACT_RPC_URL: optionalUrl,
  DATABASE_PRIVATE_URL: optionalUrl,
  DATABASE_URL: optionalUrl,
  ENVIRONMENT: z.enum(["development", "preview", "staging", "production", "test"]).default("development"),
  FX_BENTO_CHAIN_ID: optionalPositiveInt,
  FX_BENTO_COMMITMENT_MANAGER_ADDRESS: optionalAddress,
  FX_BENTO_DB_PATH: optionalNonEmptyString,
  FX_BENTO_DATABASE_URL: optionalUrl,
  FX_BENTO_ESCROW_ADDRESS: optionalAddress,
  FX_BENTO_FACTORY_ADDRESS: optionalAddress,
  FX_BENTO_FROM_BLOCK: optionalNonnegativeInt,
  FX_BENTO_HOOK_ADDRESS: optionalAddress,
  FX_BENTO_OPS_SLACK_CHANNEL_ID: optionalNonEmptyString,
  FX_BENTO_POOL_REGISTRY_ADDRESS: optionalAddress,
  FX_BENTO_PROTOCOL_FEE_VAULT_ADDRESS: optionalAddress,
  FX_BENTO_RPC_URL: optionalUrl,
  FX_BENTO_ROOM_ESCROW_ADDRESS: optionalAddress,
  FX_BENTO_ROOM_FACTORY_ADDRESS: optionalAddress,
  FX_BENTO_ROUND_MANAGER_ADDRESS: optionalAddress,
  FX_BENTO_SCORING_ADDRESS: optionalAddress,
  FX_BENTO_SETTLEMENT_ADDRESS: optionalAddress,
  FX_BENTO_SETTLEMENT_MANAGER_ADDRESS: optionalAddress,
  LIVEBLOCKS_SECRET_KEY: optionalNonEmptyString,
  MARKET_DATA_RPC_URL: optionalUrl,
  NODE_ENV: z.string().optional(),
  OPERATOR_ALERT_DEDUP_SECONDS: z.coerce.number().int().positive().default(900),
  OPERATOR_ALERT_MIN_SEVERITY: z.enum(["warning", "critical"]).default("warning"),
  OPERATOR_ALERT_WEBHOOK_URL: optionalUrl,
  PONDER_CHAIN_ID: optionalPositiveInt,
  PONDER_FX_BENTO_START_BLOCK: optionalNonnegativeInt,
  SLACK_BOT_TOKEN: optionalNonEmptyString,
  PONDER_GRAPHQL_URL: optionalUrl,
  PONDER_RPC_URL: optionalUrl,
  PONDER_SQL_URL: optionalUrl,
  POSTGRES_URL: optionalUrl,
  PRISMA_DATABASE_URL: optionalUrl,
  PORT: z.coerce.number().int().positive().default(8787),
  SIMULATION_ACCOUNT_ADDRESS: optionalAddress,
  SETTLEMENT_RESULT_STORE_PATH: optionalNonEmptyString,
  TREASURY_ADDRESS: optionalAddress,
  WORKER_JOB_STORE_PATH: optionalNonEmptyString,
  WORKER_PORT: z.coerce.number().int().positive().default(8788),
  WORKER_STUCK_JOB_SECONDS: z.coerce.number().int().positive().default(600),
  X402_NETWORK: z.preprocess(emptyToUndefined, z.string().min(1).default("eip155:84532")),
  X402_RECEIVER_ADDRESS: optionalAddress,
  X402_VERIFIER_URL: optionalUrl,
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
