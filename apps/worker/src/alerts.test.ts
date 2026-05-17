import { beforeEach, describe, expect, test } from "bun:test";

import { dispatchOperatorAlerts, resetOperatorAlertDedupeForTests } from "./alerts";
import type { FxBentoWorkerHealthSnapshot } from "./jobs";

const baseHealth: FxBentoWorkerHealthSnapshot = {
  status: "degraded",
  totalJobs: 1,
  byStatus: { queued: 0, running: 1, completed: 0, failed: 0 },
  byKind: { finalize_results: 1 },
  pendingConfirmations: 1,
  pendingReceiptCount: 0,
  pendingPonderCount: 1,
  failedJobs: 0,
  dueJobs: 0,
  nextDueJobAt: null,
  oldestPendingConfirmationAgeSeconds: 1_200,
  maxPonderLagSeconds: 180,
  alerts: [
    {
      code: "pending_ponder",
      severity: "warning",
      message: "Worker jobs are waiting for Ponder to index confirmed transactions.",
      count: 1,
    },
    {
      code: "stuck_worker_jobs",
      severity: "critical",
      message: "A worker confirmation has exceeded the stuck-job threshold.",
      jobId: "job-1",
      kind: "finalize_results",
      roomId: "1",
      chainId: 31337,
      ageSeconds: 1_200,
    },
  ],
  stuckJobs: [
    {
      id: "job-1",
      kind: "finalize_results",
      roomId: "1",
      chainId: 31337,
      ageSeconds: 1_200,
    },
  ],
  stuckFinalizations: [
    {
      id: "job-1",
      roomId: "1",
      chainId: 31337,
      ageSeconds: 1_200,
    },
  ],
};

const env = {
  ENVIRONMENT: "production" as const,
  OPERATOR_ALERT_DEDUP_SECONDS: 900,
  OPERATOR_ALERT_MIN_SEVERITY: "warning" as const,
  SLACK_BOT_TOKEN: "xoxb-test-token",
  FX_BENTO_OPS_SLACK_CHANNEL_ID: "C0FXBENTO",
};

const slackOkResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe("operator alert sink", () => {
  beforeEach(() => {
    resetOperatorAlertDedupeForTests();
  });

  test("returns disabled status when slack credentials are missing", async () => {
    const result = await dispatchOperatorAlerts({
      env: { ...env, SLACK_BOT_TOKEN: undefined },
      jobHealth: baseHealth,
      source: "operator_health",
    });

    expect(result).toEqual({
      configured: false,
      dispatched: 0,
      suppressed: 0,
      minSeverity: "warning",
    });
  });

  test("posts operator alerts to slack chat.postMessage with bearer auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await dispatchOperatorAlerts({
      env,
      jobHealth: baseHealth,
      source: "operator_dashboard",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init });
        return slackOkResponse();
      },
      now: () => 1_000,
    });

    expect(result).toMatchObject({
      configured: true,
      dispatched: 2,
      suppressed: 0,
      slackChannelId: "C0FXBENTO",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer xoxb-test-token");
    expect(headers["content-type"]).toContain("application/json");

    const payload = JSON.parse(String(calls[0]?.init?.body)) as {
      channel: string;
      text: string;
      mrkdwn: boolean;
    };
    expect(payload.channel).toBe("C0FXBENTO");
    expect(payload.mrkdwn).toBe(true);
    expect(payload.text).toContain("FX Bento worker degraded");
    expect(payload.text).toContain("1 critical, 1 warning");
    expect(payload.text).toContain("`stuck_worker_jobs`");
    expect(payload.text).toContain("`pending_ponder`");
  });

  test("posts operator alerts to a generic webhook when configured", async () => {
    const payloads: unknown[] = [];
    const result = await dispatchOperatorAlerts({
      env: {
        ...env,
        SLACK_BOT_TOKEN: undefined,
        FX_BENTO_OPS_SLACK_CHANNEL_ID: undefined,
        OPERATOR_ALERT_WEBHOOK_URL: "https://alerts.example.test/fx-bento",
      },
      jobHealth: baseHealth,
      source: "operator_dashboard",
      fetcher: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      },
      now: () => 1_000,
    });

    expect(result).toMatchObject({
      configured: true,
      dispatched: 2,
      suppressed: 0,
      endpointHost: "alerts.example.test",
    });
    expect(payloads).toEqual([
      expect.objectContaining({
        service: "fx-bento-worker",
        environment: "production",
        source: "operator_dashboard",
        alerts: baseHealth.alerts,
        operator: expect.objectContaining({ pendingPonderCount: 1, stuckJobs: baseHealth.stuckJobs }),
      }),
    ]);
  });

  test("dedupes repeated alert dispatches inside the configured window", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return slackOkResponse();
    };

    await dispatchOperatorAlerts({ env, jobHealth: baseHealth, source: "health", fetcher, now: () => 1_000 });
    const second = await dispatchOperatorAlerts({ env, jobHealth: baseHealth, source: "health", fetcher, now: () => 2_000 });

    expect(calls).toBe(1);
    expect(second).toMatchObject({ dispatched: 0, suppressed: 2 });
  });

  test("honors critical-only alert severity", async () => {
    const payloads: string[] = [];
    const result = await dispatchOperatorAlerts({
      env: { ...env, OPERATOR_ALERT_MIN_SEVERITY: "critical" },
      jobHealth: baseHealth,
      source: "jobs_drain",
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { text: string };
        payloads.push(body.text);
        return slackOkResponse();
      },
      now: () => 1_000,
    });

    expect(result).toMatchObject({ dispatched: 1 });
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toContain("`stuck_worker_jobs`");
    expect(payloads[0]).not.toContain("`pending_ponder`");
  });

  test("surfaces slack api errors without marking dispatched", async () => {
    const result = await dispatchOperatorAlerts({
      env,
      jobHealth: baseHealth,
      source: "operator_health",
      fetcher: async () =>
        new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 }),
      now: () => 1_000,
    });

    expect(result).toMatchObject({
      configured: true,
      dispatched: 0,
      lastError: "channel_not_found",
      slackChannelId: "C0FXBENTO",
    });
  });
});
