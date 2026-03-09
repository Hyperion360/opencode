import { describe, expect, test } from "bun:test"
import { applyTemplate, buildBoard, buildPlaybookPrompt, buildRecoveryPrompt, buildResumePrompt, buildReviewPrompt, buildRetryPrompt, kitTemplates } from "./backlog"

describe("session backlog helpers", () => {
  test("applies a template as structured intake", () => {
    const input = applyTemplate(kitTemplates[0])

    expect(input.goal).toContain("Launch")
    expect(input.constraints).toContain("OpenCode core untouched")
    expect(input.acceptance).toContain("Verification evidence")
  })

  test("blocks delivery when validation fails", () => {
    const board = buildBoard({
      session: {
        id: "s1",
        slug: "s1",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "retry", attempt: 2, message: "retrying", next: 1 },
      todos: [{ id: "t1", content: "Fix verification", status: "cancelled", priority: "high" }],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 5, deletions: 1, status: "modified" }],
      messages: [{ id: "m1", sessionID: "s1", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "planner", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "tool", callID: "c1", tool: "typecheck", state: { status: "error", input: {}, error: "types failed", time: { start: 10, end: 11 } } }],
      agents: [{ name: "planner", mode: "primary", permission: [], options: {} }],
      commands: [],
      now: 60_000,
    })

    expect(board.execution.failed).toBe(1)
    expect(board.execution.state).toBe("retry")
    expect(board.verification.state).toBe("blocked")
    expect(board.verification.failed).toBe(1)
    expect(board.delivery.rollback).toBe(false)
  })

  test("marks ready when checks pass and artifacts exist", () => {
    const board = buildBoard({
      session: {
        id: "s2",
        slug: "s2",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
        revert: { messageID: "m1" },
      },
      status: { type: "idle" },
      todos: [
        { id: "t1", content: "Implement", status: "completed", priority: "high" },
        { id: "t2", content: "Verify", status: "completed", priority: "medium" },
      ],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 8, deletions: 2, status: "modified" }],
      messages: [{ id: "m1", sessionID: "s2", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "implementor", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [
        { id: "p1", sessionID: "s2", messageID: "m1", type: "tool", callID: "c1", tool: "test", state: { status: "completed", input: {}, output: "ok", title: "Tests", metadata: {}, time: { start: 10, end: 11 }, attachments: [] } },
        { id: "p2", sessionID: "s2", messageID: "m1", type: "patch", hash: "hash", files: ["src/app.ts"] },
      ],
      agents: [{ name: "implementor", mode: "primary", permission: [], options: {} }],
      commands: [{ name: "verify", template: "verify", hints: [], agent: "implementor", source: "skill" }],
      now: 120_000,
    })

    expect(board.execution.done).toBe(2)
    expect(board.verification.state).toBe("ready")
    expect(board.delivery.rollback).toBe(true)
    expect(board.delivery.patches).toBe(1)
    expect(board.operations.quality).toBe(100)
  })

  test("surfaces retry api errors in activity", () => {
    const board = buildBoard({
      session: {
        id: "s3",
        slug: "s3",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "retry", attempt: 1, message: "retrying", next: 1 },
      todos: [],
      diffs: [],
      messages: [{ id: "m1", sessionID: "s3", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "planner", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [{ id: "r1", sessionID: "s3", messageID: "m1", type: "retry", attempt: 1, error: { name: "APIError", data: { message: "quota exceeded", isRetryable: false } }, time: { created: 15 } }],
      agents: [{ name: "planner", mode: "primary", permission: [], options: {} }],
      commands: [],
      now: 60_000,
    })

    expect(board.activity[0]?.title).toContain("Retry")
    expect(board.activity[0]?.detail).toBe("quota exceeded")
    expect(board.activity[0]?.tone).toBe("warning")
  })

  test("builds recovery prompts with selected context", () => {
    const retry = buildRetryPrompt({ node: "Re-run tests", template: "Feature launch", playbook: "Parallel delivery", skills: ["QA gate"] })
    const playbook = buildPlaybookPrompt({ template: "Feature launch", playbook: "Parallel delivery", skills: ["Spec guard", "QA gate"] })
    const resume = buildResumePrompt({ title: "Recovered run", focus: "Resume recovered run", detail: "Persisted board restored", template: "Feature launch", playbook: "Parallel delivery", skills: ["Spec guard"] })
    const recovery = buildRecoveryPrompt({ title: "Recovered run", node: "Recover orchestration state", detail: "quota exceeded", template: "Feature launch", playbook: "Parallel delivery", skills: ["QA gate"] })
    const review = buildReviewPrompt({ title: "Recovered run", detail: "Validation evidence is attached", template: "Feature launch", playbook: "Parallel delivery", skills: ["Ops audit"] })

    expect(retry).toContain("Task: Re-run tests")
    expect(retry).toContain("Parallel delivery")
    expect(playbook).toContain("Skill packs:")
    expect(playbook).toContain("- QA gate")
    expect(resume).toContain("Recovery focus: Resume recovered run")
    expect(recovery).toContain("Blocked node: Recover orchestration state")
    expect(review).toContain("Operator note: Validation evidence is attached")
  })

  test("keeps recovery affordance markers in the dashboard rendering", async () => {
    const view = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()

    expect(view).toContain("Recovered run state")
    expect(view).toContain("data-recovery-state")
    expect(view).toContain("onStageRecovery")
  })
})