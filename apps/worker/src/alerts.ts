import type { FxBentoEnv } from "@bufinance/fx-bento-env";

import type { FxBentoWorkerHealthAlert, FxBentoWorkerHealthSnapshot } from "./jobs";

export type OperatorAlertFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OperatorAlertDispatchInput {
  env: Pick<
    FxBentoEnv,
    | "ENVIRONMENT"
    | "OPERATOR_ALERT_DEDUP_SECONDS"
    | "OPERATOR_ALERT_MIN_SEVERITY"
    | "OPERATOR_ALERT_WEBHOOK_URL"
    | "SLACK_BOT_TOKEN"
    | "FX_BENTO_OPS_SLACK_CHANNEL_ID"
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
  slackChannelId?: string;
  lastError?: string;
}

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const lastDispatchedAt = new Map<string, number>();

export async function dispatchOperatorAlerts(
  input: OperatorAlertDispatchInput
): Promise<OperatorAlertDispatchResult> {
  const minSeverity = input.env.OPERATOR_ALERT_MIN_SEVERITY;
  const webhookUrl = input.env.OPERATOR_ALERT_WEBHOOK_URL;
  const botToken = input.env.SLACK_BOT_TOKEN;
  const channelId = input.env.FX_BENTO_OPS_SLACK_CHANNEL_ID;
  if (!webhookUrl && (!botToken || !channelId)) {
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
      endpointHost: webhookUrl ? safeHost(webhookUrl) : undefined,
      slackChannelId: webhookUrl ? undefined : channelId,
    };
  }

  if (webhookUrl) {
    const response = await (input.fetcher ?? fetch)(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildOperatorAlertPayload(input, readyAlerts)),
    }).catch((error) => (error instanceof Error ? error : new Error("operator_alert_dispatch_failed")));

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
      lastDispatchedAt.set(alertKey(alert), input.now?.() ?? Date.now());
    }
    return {
      configured: true,
      dispatched: readyAlerts.length,
      suppressed: alerts.length - readyAlerts.length,
      minSeverity,
      endpointHost: safeHost(webhookUrl),
    };
  }

  const body = JSON.stringify({
    channel: channelId,
    text: buildSlackText(input, readyAlerts),
    unfurl_links: false,
    unfurl_media: false,
    mrkdwn: true,
  });

  const response = await (input.fetcher ?? fetch)(SLACK_POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${botToken}`,
    },
    body,
  }).catch((error) => (error instanceof Error ? error : new Error("slack_post_message_failed")));

  if (response instanceof Error) {
    return {
      configured: true,
      dispatched: 0,
      suppressed: alerts.length - readyAlerts.length,
      minSeverity,
      slackChannelId: channelId,
      lastError: response.message,
    };
  }

  const parsed = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !parsed?.ok) {
    return {
      configured: true,
      dispatched: 0,
      suppressed: alerts.length - readyAlerts.length,
      minSeverity,
      slackChannelId: channelId,
      lastError: parsed?.error ?? `slack_http_${response.status}`,
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
    slackChannelId: channelId,
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

function buildSlackText(input: OperatorAlertDispatchInput, alerts: FxBentoWorkerHealthAlert[]): string {
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length;
  const emoji = criticalCount > 0 ? ":rotating_light:" : ":warning:";
  const header =
    `${emoji} *FX Bento worker ${input.jobHealth.status}* — ` +
    `${criticalCount} critical, ${warningCount} warning ` +
    `(env=\`${input.env.ENVIRONMENT}\` source=\`${input.source}\`)`;

  const lines = alerts.slice(0, 10).map((alert) => {
    const subject = alert.jobId ?? alert.roomId ?? alert.kind ?? "global";
    const age = typeof alert.ageSeconds === "number" ? ` age=\`${alert.ageSeconds}s\`` : "";
    return `• [${alert.severity}] \`${alert.code}\` ${subject}${age} — ${alert.message}`;
  });

  const overflow = alerts.length > lines.length ? `\n…and ${alerts.length - lines.length} more` : "";
  const operator = input.jobHealth;
  const footer =
    `\n_pendingPonder=${operator.pendingPonderCount} pendingReceipt=${operator.pendingReceiptCount} ` +
    `oldestPendingConfAge=${operator.oldestPendingConfirmationAgeSeconds ?? "n/a"}s ` +
    `maxPonderLag=${operator.maxPonderLagSeconds ?? "n/a"}s ` +
    `stuckJobs=${operator.stuckJobs.length} stuckFinalizations=${operator.stuckFinalizations.length}_`;

  return [header, ...lines].join("\n") + overflow + footer;
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
