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
  OPERATOR_ALERT_WEBHOOK_URL: "https://alerts.example.test/fx-bento",
};

describe("operator alert sink", () => {
  beforeEach(() => {
    resetOperatorAlertDedupeForTests();
  });

  test("returns disabled status when no webhook is configured", async () => {
    const result = await dispatchOperatorAlerts({
      env: { ...env, OPERATOR_ALERT_WEBHOOK_URL: undefined },
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

  test("posts operator alerts to the configured webhook", async () => {
    const payloads: unknown[] = [];
    const result = await dispatchOperatorAlerts({
      env,
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
      return new Response(null, { status: 204 });
    };

    await dispatchOperatorAlerts({ env, jobHealth: baseHealth, source: "health", fetcher, now: () => 1_000 });
    const second = await dispatchOperatorAlerts({ env, jobHealth: baseHealth, source: "health", fetcher, now: () => 2_000 });

    expect(calls).toBe(1);
    expect(second).toMatchObject({ dispatched: 0, suppressed: 2 });
  });

  test("honors critical-only alert severity", async () => {
    const payloads: unknown[] = [];
    const result = await dispatchOperatorAlerts({
      env: { ...env, OPERATOR_ALERT_MIN_SEVERITY: "critical" },
      jobHealth: baseHealth,
      source: "jobs_drain",
      fetcher: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      },
      now: () => 1_000,
    });

    expect(result).toMatchObject({ dispatched: 1 });
    expect(payloads).toEqual([
      expect.objectContaining({
        alerts: [expect.objectContaining({ severity: "critical", code: "stuck_worker_jobs" })],
      }),
    ]);
  });
});
