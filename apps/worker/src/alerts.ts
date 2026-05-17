import type { FxBentoEnv } from "@bufinance/fx-bento-env";

import type { FxBentoWorkerHealthAlert, FxBentoWorkerHealthSnapshot } from "./jobs";

export type OperatorAlertFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OperatorAlertDispatchInput {
  env: Pick<
    FxBentoEnv,
    "ENVIRONMENT" | "OPERATOR_ALERT_DEDUP_SECONDS" | "OPERATOR_ALERT_MIN_SEVERITY" | "OPERATOR_ALERT_WEBHOOK_URL"
  >;
  jobHealth: FxBentoWorkerHealthSnapshot;
  indexer?: unknown;
  source: "health" | "operator_health" | "operator_dashboard" | "jobs_drain";
  fetcher?: OperatorAlertFetch;
  now?: () => number;
}

export interface OperatorAlertDispatchResult {
  configured: boolean;
  dispatched: number;
  suppressed: number;
  minSeverity: "warning" | "critical";
  endpointHost?: string;
  lastError?: string;
}

const lastDispatchedAt = new Map<string, number>();

export async function dispatchOperatorAlerts(
  input: OperatorAlertDispatchInput
): Promise<OperatorAlertDispatchResult> {
  const minSeverity = input.env.OPERATOR_ALERT_MIN_SEVERITY;
  const webhookUrl = input.env.OPERATOR_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return { configured: false, dispatched: 0, suppressed: 0, minSeverity };
  }

  const now = input.now?.() ?? Date.now();
  const dedupMs = input.env.OPERATOR_ALERT_DEDUP_SECONDS * 1000;
  const alerts = input.jobHealth.alerts.filter((alert) => meetsSeverity(alert, minSeverity));
  const readyAlerts = alerts.filter((alert) => {
    const key = alertKey(alert);
    const last = lastDispatchedAt.get(key);
    if (last !== undefined && now - last < dedupMs) return false;
    return true;
  });

  if (readyAlerts.length === 0) {
    return {
      configured: true,
      dispatched: 0,
      suppressed: alerts.length,
      minSeverity,
      endpointHost: safeHost(webhookUrl),
    };
  }

  const response = await (input.fetcher ?? fetch)(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildOperatorAlertPayload(input, readyAlerts)),
  }).catch((error) => error instanceof Error ? error : new Error("operator_alert_dispatch_failed"));

  if (response instanceof Error) {
    return {
      configured: true,
      dispatched: 0,
      suppressed: alerts.length - readyAlerts.length,
      minSeverity,
      endpointHost: safeHost(webhookUrl),
      lastError: response.message,
    };
  }
  if (!response.ok) {
    return {
      configured: true,
      dispatched: 0,
      suppressed: alerts.length - readyAlerts.length,
      minSeverity,
      endpointHost: safeHost(webhookUrl),
      lastError: `operator_alert_http_${response.status}`,
    };
  }

  for (const alert of readyAlerts) {
    lastDispatchedAt.set(alertKey(alert), now);
  }

  return {
    configured: true,
    dispatched: readyAlerts.length,
    suppressed: alerts.length - readyAlerts.length,
    minSeverity,
    endpointHost: safeHost(webhookUrl),
  };
}

export function resetOperatorAlertDedupeForTests(): void {
  lastDispatchedAt.clear();
}

function buildOperatorAlertPayload(input: OperatorAlertDispatchInput, alerts: FxBentoWorkerHealthAlert[]) {
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length;
  return {
    text: `FX Bento worker ${input.jobHealth.status}: ${criticalCount} critical, ${warningCount} warning alerts`,
    service: "fx-bento-worker",
    environment: input.env.ENVIRONMENT,
    source: input.source,
    status: input.jobHealth.status,
    alerts,
    operator: {
      pendingConfirmations: input.jobHealth.pendingConfirmations,
      pendingReceiptCount: input.jobHealth.pendingReceiptCount,
      pendingPonderCount: input.jobHealth.pendingPonderCount,
      oldestPendingConfirmationAgeSeconds: input.jobHealth.oldestPendingConfirmationAgeSeconds,
      maxPonderLagSeconds: input.jobHealth.maxPonderLagSeconds,
      stuckJobs: input.jobHealth.stuckJobs,
      stuckFinalizations: input.jobHealth.stuckFinalizations,
    },
    indexer: input.indexer ?? null,
    dispatchedAt: new Date().toISOString(),
  };
}

function meetsSeverity(alert: FxBentoWorkerHealthAlert, minSeverity: "warning" | "critical"): boolean {
  if (minSeverity === "warning") return true;
  return alert.severity === "critical";
}

function alertKey(alert: FxBentoWorkerHealthAlert): string {
  return [alert.code, alert.severity, alert.jobId ?? alert.kind ?? "global", alert.roomId ?? "", alert.chainId ?? ""].join(":");
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
