import { createLogger, createLoggerWithContext } from "@bufinance/logger";

export { createLogger, createLoggerWithContext, logger } from "@bufinance/logger";
export type { Logger, LogLevel } from "@bufinance/logger";

export const apiLogger = createLogger({ prefix: "fx-bento:api" });
export const indexerLogger = createLogger({ prefix: "fx-bento:ponder" });
export const workflowLogger = createLoggerWithContext("fx-bento:mcp");
