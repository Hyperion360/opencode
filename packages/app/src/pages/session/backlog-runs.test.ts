import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { Board } from "./backlog"

type BacklogModule = typeof import("./backlog")

const saved = new Map<string, string>()
let backlog: BacklogModule

const board = (input: { state: "idle" | "running" | "retry"; total: number; title?: string }) =>
  ({
    execution: {
      total: input.total,
      done: 0,
      active: input.state === "idle" ? 0 : 1,
      failed: input.state === "retry" ? 1 : 0,
      parallel: false,
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
      state: input.state === "idle" ? "idle" : "blocked",
      label: input.state === "idle" ? "Awaiting verification" : "Delivery blocked",
      summary: input.state === "idle" ? "Waiting for evidence." : "Recovery is still in progress.",
      total: input.total,
      passed: 0,
      failed: input.state === "retry" ? 1 : 0,
      pending: input.state === "running" ? 1 : 0,
      logs: input.total,
      artifacts: 0,
      checks: [],
    },
    delivery: {
      files: input.total,
      additions: input.total,
      deletions: 0,
      patches: 0,
      rollback: false,
    },
    agent: {
      total: input.total,
      active: input.state === "idle" ? 0 : 1,
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
      retries: input.state === "retry" ? 1 : 0,
      rollback: false,
      activation: 0,
      quality: 100,
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

    expect(restored.execution.state).toBe("retry")
    expect(restored.execution.nodes[0]?.label).toBe("Recover orchestration state")
    expect(fresh.execution.state).toBe("running")
    expect(fresh.activity[0]?.title).toBe("Fresh live state")
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
})