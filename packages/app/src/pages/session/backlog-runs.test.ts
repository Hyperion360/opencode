import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { Board } from "./backlog"

type BacklogModule = typeof import("./backlog")

const saved = new Map<string, string>()
let backlog: BacklogModule

const board = (input: {
  state: "idle" | "running" | "retry"
  total: number
  title?: string
  verify?: Board["verification"]["state"]
  files?: number
  retryCount?: number
  parallel?: boolean
  activeAgents?: number
  rollback?: boolean
  activation?: number
  quality?: number
}) =>
  ({
    execution: {
      total: input.total,
      done: 0,
      active: input.state === "idle" ? 0 : 1,
      failed: input.state === "retry" ? 1 : 0,
      parallel: input.parallel ?? false,
      state: input.state,
      nodes:
        input.total === 0
          ? []
          : [
              {
                id: "n1",
                label: input.title ?? "Recover orchestration state",
                status: input.state === "retry" ? "cancelled" : "in_progress",
                priority: "high",
                retry: input.state === "retry",
              },
            ],
    },
    verification: {
      state: input.verify ?? (input.state === "idle" ? "idle" : "blocked"),
      label:
        (input.verify ?? (input.state === "idle" ? "idle" : "blocked")) === "ready"
          ? "Ready for delivery"
          : (input.verify ?? (input.state === "idle" ? "idle" : "blocked")) === "blocked"
            ? "Delivery blocked"
            : "Awaiting verification",
      summary:
        (input.verify ?? (input.state === "idle" ? "idle" : "blocked")) === "ready"
          ? "Validation evidence is attached."
          : input.state === "idle"
            ? "Waiting for evidence."
            : "Recovery is still in progress.",
      total: input.total,
      passed: 0,
      failed: input.retryCount ?? (input.state === "retry" ? 1 : 0),
      pending: input.state === "running" ? 1 : 0,
      logs: input.total,
      artifacts: 0,
      checks: [],
    },
    delivery: {
      files: input.files ?? 0,
      additions: input.files ?? 0,
      deletions: 0,
      patches: 0,
      rollback: input.rollback ?? false,
    },
    agent: {
      total: input.total,
      active: input.activeAgents ?? (input.state === "idle" ? 0 : 1),
      board: [],
    },
    activity:
      input.total === 0
        ? []
        : [
            {
              id: "a1",
              title: input.title ?? "Retry · attempt 2",
              detail: "Recovered from persisted state",
              tone: input.state === "retry" ? "warning" : "normal",
              at: 10,
            },
          ],
    operations: {
      audit: input.total,
      retries: input.retryCount ?? (input.state === "retry" ? 1 : 0),
      rollback: input.rollback ?? false,
      activation: input.activation ?? 0,
      quality: input.quality ?? 100,
      duration: 1,
    },
  }) satisfies Board

beforeAll(async () => {
  mock.module("@/utils/persist", () => {
    return {
      Persist: {
        workspace: (_dir: string, key: string) => ({ key }),
      },
      persisted: <T extends object>(target: string | { key: string }, store: ReturnType<typeof createStore<T>>) => {
        const key = typeof target === "string" ? target : target.key
        const raw = saved.get(key)
        const [state, setState] = createStore<T>(raw ? (JSON.parse(raw) as T) : store[0])
        const next = ((...args: unknown[]) => {
          ;(setState as unknown as (...input: unknown[]) => void)(...args)
          saved.set(key, JSON.stringify(state))
        }) as typeof setState

        return [state, next, null, () => true] as const
      },
    }
  })

  backlog = await import("./backlog")
})

beforeEach(() => {
  saved.clear()
})

describe("workspace run persistence", () => {
  test("rehydrates the persisted board when live orchestration state is empty", () => {
    const record = backlog.buildRunRecord({
      sessionID: "s1",
      title: "Durable run",
      updatedAt: 10,
      board: board({ state: "retry", total: 1 }),
      wave: { type: "retry", attempt: 2, message: "quota exceeded", next: 1 },
    })

    const restored = backlog.resolveRunBoard({
      live: board({ state: "idle", total: 0, title: "Empty live state" }),
      record,
      status: { type: "idle" },
    })
    const fresh = backlog.resolveRunBoard({
      live: board({ state: "running", total: 1, title: "Fresh live state" }),
      record,
      status: { type: "busy" },
    })
    const liveRecovery = backlog.resolveRunRecovery({
      live: board({ state: "running", total: 1, title: "Fresh live state" }),
      record,
      status: { type: "busy" },
    })

    expect(restored.execution.state).toBe("retry")
    expect(restored.execution.nodes[0]?.label).toBe("Recover orchestration state")
    expect(fresh.execution.state).toBe("running")
    expect(fresh.activity[0]?.title).toBe("Fresh live state")
    expect(liveRecovery).toBeUndefined()
  })

  test("persists and rehydrates run records per canonical workspace", () => {
    const record = backlog.buildRunRecord({
      sessionID: "s1",
      title: "Durable run",
      updatedAt: 25,
      board: board({ state: "retry", total: 1 }),
      wave: { type: "retry", attempt: 3, message: "retrying", next: 1 },
    })

    createRoot((dispose) => {
      const runs = backlog.createWorkspaceRuns(() => "/private/var/tmp/hyperion/")
      expect(runs.ready()).toBe(true)
      runs.remember(record)
      dispose()
    })

    createRoot((dispose) => {
      const runs = backlog.createWorkspaceRuns(() => "/var/tmp/hyperion")
      const restored = runs.run("s1")

      expect(restored?.title).toBe("Durable run")
      expect(restored?.board.execution.state).toBe("retry")
      expect(restored?.board.activity[0]?.detail).toBe("Recovered from persisted state")
      expect(restored?.wave.type).toBe("retry")
      if (restored?.wave.type === "retry") expect(restored.wave.attempt).toBe(3)
      dispose()
    })
  })

  test("persists and rehydrates workspace metrics snapshots per canonical workspace", () => {
    const snapshot = {
      sessionID: "s-metrics",
      title: "Pilot run",
      updatedAt: 25,
      activation: 67,
      quality: 82,
      execution: "running",
      verification: "ready",
      review: "warning",
      delivery: {
        ready: 3,
        total: 4,
        files: 2,
        rollback: true,
      },
      retries: 1,
    } as const

    createRoot((dispose) => {
      const metrics = backlog.createWorkspaceMetrics(() => "/private/var/tmp/hyperion/")
      expect(metrics.ready()).toBe(true)
      metrics.remember(snapshot)
      dispose()
    })

    createRoot((dispose) => {
      const metrics = backlog.createWorkspaceMetrics(() => "/var/tmp/hyperion")
      const restored = metrics.latest()

      expect(restored).toEqual(snapshot)
      dispose()
    })
  })

  test("restores persisted activation and quality when live state is empty", () => {
    const snapshot = {
      sessionID: "s-metrics",
      title: "Pilot run",
      updatedAt: 25,
      activation: 67,
      quality: 82,
      execution: "running",
      verification: "ready",
      review: "warning",
      delivery: {
        ready: 3,
        total: 4,
        files: 2,
        rollback: true,
      },
      retries: 1,
    } as const

    const metric = backlog.resolveMetricsSnapshot({
      board: board({ state: "idle", total: 0 }),
      snapshot,
      status: { type: "idle" },
    })
    const restored = backlog.resolveMetricBoard({
      board: board({ state: "idle", total: 0 }),
      snapshot,
      status: { type: "idle" },
    })
    const active = backlog.resolveMetricsSnapshot({
      board: board({ state: "running", total: 1, activation: 14, quality: 33 }),
      snapshot,
      status: { type: "busy" },
    })
    const live = backlog.resolveMetricBoard({
      board: board({ state: "running", total: 1, activation: 14, quality: 33 }),
      snapshot,
      status: { type: "busy" },
    })

    expect(metric).toEqual(snapshot)
    expect(active).toBeUndefined()
    expect(restored.operations.activation).toBe(67)
    expect(restored.operations.quality).toBe(82)
    expect(live.operations.activation).toBe(14)
    expect(live.operations.quality).toBe(33)
  })

  test("surfaces a resumable recovery when only persisted running state remains", () => {
    const record = backlog.buildRunRecord({
      sessionID: "s2",
      title: "Durable run",
      updatedAt: 15,
      board: board({ state: "running", total: 2, title: "Resume orchestration" }),
      wave: { type: "busy" },
    })

    const recovery = backlog.resolveRunRecovery({
      live: board({ state: "idle", total: 0 }),
      record,
      status: { type: "idle" },
    })

    expect(recovery?.state).toBe("resumable")
    expect(recovery?.action.kind).toBe("resume")
    expect(recovery?.approval).toBeUndefined()
  })

  test("adds an approval checkpoint before risky recovered continuation", () => {
    const record = backlog.buildRunRecord({
      sessionID: "s-risk",
      title: "Durable run",
      updatedAt: 18,
      board: board({ state: "running", total: 2, title: "Resume orchestration", files: 3, parallel: true, activeAgents: 2 }),
      wave: { type: "busy" },
    })

    const recovery = backlog.resolveRunRecovery({
      live: board({ state: "idle", total: 0 }),
      record,
      status: { type: "idle" },
    })

    expect(recovery?.state).toBe("resumable")
    expect(recovery?.action.kind).toBe("resume")
    expect(recovery?.approval?.title).toBe("Approval needed before continuation")
    expect(recovery?.approval?.label).toBe("Stage approval checkpoint")
    expect(recovery?.approval?.detail).toContain("3 changed files are already attached")
  })

  test("surfaces a failed recovery when the persisted run ended in retry", () => {
    const record = backlog.buildRunRecord({
      sessionID: "s3",
      title: "Durable run",
      updatedAt: 20,
      board: board({ state: "retry", total: 1, title: "Recover orchestration state" }),
      wave: { type: "retry", attempt: 2, message: "quota exceeded", next: 1 },
    })

    const recovery = backlog.resolveRunRecovery({
      live: board({ state: "idle", total: 0 }),
      record,
      status: { type: "idle" },
    })

    expect(recovery?.state).toBe("failed")
    expect(recovery?.action.kind).toBe("recover")
    expect(recovery?.detail).toContain("quota exceeded")
  })

  test("surfaces operator review when recovered delivery evidence is waiting", () => {
    const record = backlog.buildRunRecord({
      sessionID: "s4",
      title: "Durable run",
      updatedAt: 30,
      board: board({ state: "idle", total: 1, title: "Prepare handoff", verify: "ready", files: 2 }),
      wave: { type: "idle" },
    })

    const recovery = backlog.resolveRunRecovery({
      live: board({ state: "idle", total: 0 }),
      record,
      status: { type: "idle" },
    })

    expect(recovery?.state).toBe("awaiting")
    expect(recovery?.action.kind).toBe("review")
    expect(recovery?.title).toBe("Awaiting delivery review")
    expect(recovery?.approval).toBeUndefined()
  })
})