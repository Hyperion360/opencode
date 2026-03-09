import { describe, expect, test } from "bun:test"
import { applyTemplate, buildApprovalPrompt, buildBoard, buildCiPayload, buildDeliveryPacket, buildIntegrationPayloads, buildIntegrationStagePrompt, buildMetricTrends, buildMetricsReadiness, buildMetricsSnapshot, buildNotificationPayload, buildPlaybookPrompt, buildPullRequestPayload, buildRecoveryPrompt, buildResumePrompt, buildReviewPrompt, buildRetryPrompt, buildSpecReview, kitTemplates } from "./backlog"

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

  test("captures validation provenance and condensed log summaries", () => {
    const board = buildBoard({
      session: {
        id: "s4",
        slug: "s4",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "idle" },
      todos: [{ id: "t1", content: "Verify", status: "completed", priority: "high" }],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 4, deletions: 1, status: "modified" }],
      messages: [{ id: "m1", sessionID: "s4", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "implementor", path: { cwd: "/tmp/app/packages/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [
        {
          id: "p1",
          sessionID: "s4",
          messageID: "m1",
          type: "tool",
          callID: "c1",
          tool: "test",
          state: {
            status: "completed",
            input: { command: "bun run test:unit" },
            output: "12 pass\n0 fail\nSaved junit.xml",
            title: "Unit tests",
            metadata: {},
            time: { start: 10, end: 11 },
            attachments: [],
          },
        },
      ],
      agents: [{ name: "implementor", mode: "primary", permission: [], options: {} }],
      commands: [{ name: "test", template: "test", hints: ["test"], agent: "implementor", source: "skill" }],
      now: 120_000,
    })

    expect(board.verification.checks[0]).toMatchObject({
      detail: "Unit tests",
      provenance: {
        command: "bun run test:unit",
        source: "Skill command",
        agent: "implementor",
        cwd: "packages/app",
        call: "c1",
      },
      log: {
        summary: "12 pass · 0 fail",
        excerpt: "12 pass\n0 fail\nSaved junit.xml",
      },
    })
  })

  test("surfaces stale spec drift and missing reviewer evidence", () => {
    const board = buildBoard({
      session: {
        id: "s5",
        slug: "s5",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "idle" },
      todos: [{ id: "t1", content: "Ship dashboard", status: "completed", priority: "high" }],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 6, deletions: 1, status: "modified" }],
      messages: [],
      parts: [],
      agents: [],
      commands: [],
      now: 120_000,
    })

    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "stale",
        input: {
          goal: "Ship delivery review signals",
          constraints: "keep layout intact",
          acceptance: "show reviewer summary",
        },
      },
    })

    expect(review.state).toBe("blocked")
    expect(review.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "drift", tone: "danger" }),
        expect.objectContaining({ id: "evidence", tone: "danger" }),
      ]),
    )
    expect(review.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "stale-spec", tone: "danger" }),
        expect.objectContaining({ id: "missing-validation", tone: "danger" }),
      ]),
    )
  })

  test("marks reviewer summary ready when spec and evidence align", () => {
    const board = buildBoard({
      session: {
        id: "s6",
        slug: "s6",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
        revert: { messageID: "m1" },
      },
      status: { type: "idle" },
      todos: [{ id: "t1", content: "Review", status: "completed", priority: "high" }],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" }],
      messages: [{ id: "m1", sessionID: "s6", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "implementor", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [{ id: "p1", sessionID: "s6", messageID: "m1", type: "tool", callID: "c1", tool: "test", state: { status: "completed", input: { command: "bun run test:unit" }, output: "12 pass", title: "Unit tests", metadata: {}, time: { start: 10, end: 11 }, attachments: [] } }],
      agents: [{ name: "implementor", mode: "primary", permission: [], options: {} }],
      commands: [],
      now: 120_000,
    })

    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Ship reviewer summary",
          constraints: "keep verification drawer\nno layout changes",
          acceptance: "show spec summary\nshow reviewer risks",
        },
      },
    })

    expect(review.state).toBe("ready")
    expect(review.risks).toHaveLength(0)
    expect(review.summary).toContain("no open reviewer risks")
    expect(review.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "drift", tone: "success" }),
        expect.objectContaining({ id: "assumptions", tone: "success" }),
        expect.objectContaining({ id: "evidence", tone: "success" }),
      ]),
    )
  })

  test("builds a delivery packet with checklist state and artifact summaries", () => {
    const board = buildBoard({
      session: {
        id: "s7",
        slug: "s7",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Run",
        version: "1",
        time: { created: 0, updated: 0 },
        revert: { messageID: "m1" },
      },
      status: { type: "idle" },
      todos: [{ id: "t1", content: "Deliver", status: "completed", priority: "high" }],
      diffs: [
        { file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" },
        { file: "src/review.ts", before: "a", after: "b", additions: 2, deletions: 0, status: "modified" },
      ],
      messages: [{ id: "m1", sessionID: "s7", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "implementor", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [{ id: "p1", sessionID: "s7", messageID: "m1", type: "tool", callID: "c1", tool: "test", state: { status: "completed", input: { command: "bun run test:unit" }, output: "12 pass", title: "Unit tests", metadata: {}, time: { start: 10, end: 11 }, attachments: [] } }],
      agents: [{ name: "implementor", mode: "primary", permission: [], options: {} }],
      commands: [],
      now: 120_000,
    })
    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Ship delivery packet",
          constraints: "keep accepted validation drawer",
          acceptance: "export delivery packet",
        },
      },
    })
    const packet = buildDeliveryPacket({
      title: "Reviewer handoff",
      board,
      review,
      diffs: [
        { file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" },
        { file: "src/review.ts", before: "a", after: "b", additions: 2, deletions: 0, status: "modified" },
      ],
      now: 0,
    })

    expect(packet.name).toBe("reviewer-handoff-delivery-packet.md")
    expect(packet.summary).toContain("delivery checks")
    expect(packet.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "spec", state: "ready" }),
        expect.objectContaining({ id: "validation", state: "ready" }),
        expect.objectContaining({ id: "changes", state: "ready" }),
        expect.objectContaining({ id: "handoff", state: "ready" }),
      ]),
    )
    expect(packet.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "diffs", facts: expect.arrayContaining(["src/app.ts (+3/-1)"]) }),
        expect.objectContaining({ id: "validation", detail: expect.stringContaining("1 validation run passed") }),
      ]),
    )
    expect(packet.body).toContain("## Delivery checklist")
    expect(packet.body).toContain("## Artifact cards")
    expect(packet.body).toContain("src/review.ts (+2/-0)")
  })

  test("builds a compact workspace metrics snapshot from board review and delivery state", () => {
    const board = buildBoard({
      session: {
        id: "s8",
        slug: "s8",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Pilot run",
        version: "1",
        time: { created: 0, updated: 0 },
        revert: { messageID: "m1" },
      },
      status: { type: "idle" },
      todos: [
        { id: "t1", content: "Implement", status: "completed", priority: "high" },
        { id: "t2", content: "Verify", status: "completed", priority: "medium" },
      ],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" }],
      messages: [{ id: "m1", sessionID: "s8", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "implementor", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [{ id: "p1", sessionID: "s8", messageID: "m1", type: "tool", callID: "c1", tool: "test", state: { status: "completed", input: { command: "bun run test:unit" }, output: "12 pass", title: "Unit tests", metadata: {}, time: { start: 10, end: 11 }, attachments: [] } }],
      agents: [{ name: "implementor", mode: "primary", permission: [], options: {} }],
      commands: [],
      now: 120_000,
    })
    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Ship workspace metrics persistence",
          constraints: "keep recovery flow intact",
          acceptance: "restore activation and quality",
        },
      },
    })
    const delivery = buildDeliveryPacket({
      title: "Pilot run",
      board,
      review,
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" }],
      now: 120_000,
    })
    const snapshot = buildMetricsSnapshot({
      sessionID: "s8",
      title: "Pilot run",
      board,
      review,
      delivery,
      now: 321,
    })

    expect(snapshot).toEqual(
      expect.objectContaining({
        sessionID: "s8",
        title: "Pilot run",
        updatedAt: 321,
        activation: 100,
        quality: 100,
        execution: "idle",
        verification: "ready",
        review: "ready",
        delivery: {
          ready: 4,
          total: 4,
          files: 1,
          rollback: true,
        },
        retries: 0,
      }),
    )
  })

  test("builds reusable outbound payloads from accepted delivery state", () => {
    const diffs = [
      { file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" as const },
      { file: "src/review.ts", before: "a", after: "b", additions: 2, deletions: 0, status: "modified" as const },
    ]
    const board = buildBoard({
      session: {
        id: "s11",
        slug: "s11",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Pilot handoff",
        version: "1",
        time: { created: 0, updated: 0 },
        revert: { messageID: "m1" },
      },
      status: { type: "idle" },
      todos: [
        { id: "t1", content: "Implement", status: "completed", priority: "high" },
        { id: "t2", content: "Verify", status: "completed", priority: "medium" },
      ],
      diffs,
      messages: [{ id: "m1", sessionID: "s11", role: "assistant", time: { created: 10 }, parentID: "u1", modelID: "m", providerID: "p", mode: "default", agent: "implementor", path: { cwd: "/tmp/app", root: "/tmp/app" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }],
      parts: [{ id: "p1", sessionID: "s11", messageID: "m1", type: "tool", callID: "c1", tool: "test", state: { status: "completed", input: { command: "bun run test:unit" }, output: "12 pass", title: "Unit tests", metadata: {}, time: { start: 10, end: 11 }, attachments: [] } }],
      agents: [{ name: "implementor", mode: "primary", permission: [], options: {} }],
      commands: [],
      now: 120_000,
    })
    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Ship integration builders",
          constraints: "keep delivery evidence intact",
          acceptance: "generate reusable outbound payloads",
        },
      },
    })
    const delivery = buildDeliveryPacket({
      title: "Pilot handoff",
      board,
      review,
      diffs,
      now: 120_000,
    })
    const metrics = buildMetricsSnapshot({
      sessionID: "s11",
      title: "Pilot handoff",
      board,
      review,
      delivery,
      now: 321,
    })
    const pr = buildPullRequestPayload({ sessionID: "s11", title: "Pilot handoff", board, review, delivery, diffs, metrics })
    const ci = buildCiPayload({ sessionID: "s11", title: "Pilot handoff", board, review, delivery, diffs, metrics })
    const payloads = buildIntegrationPayloads({ sessionID: "s11", title: "Pilot handoff", board, review, delivery, diffs, metrics })

    expect(pr).toEqual(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "pr", label: "Pull request" }),
        state: "ready",
        files: expect.arrayContaining(["src/app.ts (+3/-1)"]),
      }),
    )
    expect(pr.body).toContain("## Integration context")
    expect(ci).toEqual(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "ci", label: "CI update" }),
        state: "success",
        checks: expect.arrayContaining(["Test · completed · Unit tests"]),
      }),
    )
    expect(payloads.issue.labels).toEqual(expect.arrayContaining(["ready"]))
    expect(payloads.notification.reviewReady).toEqual(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "notification" }),
        tone: "success",
        title: expect.stringContaining("ready for review"),
      }),
    )
  })

  test("falls back to live state and generic approval copy when integration context is incomplete", () => {
    const diffs = [{ file: "src/app.ts", before: "a", after: "b", additions: 4, deletions: 1, status: "modified" as const }]
    const board = buildBoard({
      session: {
        id: "s12",
        slug: "s12",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Blocked handoff",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "idle" },
      todos: [{ id: "t1", content: "Verify integration payloads", status: "in_progress", priority: "high" }],
      diffs,
      messages: [],
      parts: [],
      agents: [],
      commands: [],
      now: 120_000,
    })
    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Ship integration builders",
          constraints: "stay additive",
          acceptance: "preserve current review signals",
        },
      },
    })
    const delivery = buildDeliveryPacket({
      title: "Blocked handoff",
      board,
      review,
      diffs,
      now: 120_000,
    })
    const pr = buildPullRequestPayload({ sessionID: "s12", title: "Blocked handoff", board, review, delivery, diffs })
    const failed = buildNotificationPayload({ sessionID: "s12", title: "Blocked handoff", board, review, delivery, diffs, event: "run-failed" })
    const approval = buildNotificationPayload({ sessionID: "s12", title: "Blocked handoff", board, review, delivery, diffs, event: "approval-needed" })
    const payloads = buildIntegrationPayloads({ sessionID: "s12", title: "Blocked handoff", board, review, delivery, diffs })

    expect(pr.state).toBe("blocked")
    expect(pr.body).toContain("Activation: 0%")
    expect(payloads.ci.state).toBe("failure")
    expect(payloads.ci.body).toContain("No validation evidence is attached to the current diff set.")
    expect(payloads.issue.labels).toEqual(expect.arrayContaining(["blocked", "validation", "review", "rollback"]))
    expect(failed.summary).toContain("no tests, typechecks, or review commands")
    expect(approval.summary).toBe("Operator approval is needed before continuing this run.")
    expect(approval.body).toContain("- Validation evidence is missing")
  })

  test("builds stage-ready integration prompts with payload metadata and fallbacks", () => {
    const diffs = [{ file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" as const }]
    const board = buildBoard({
      session: {
        id: "s13",
        slug: "s13",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Integration run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "idle" },
      todos: [{ id: "t1", content: "Ship outbound hooks", status: "completed", priority: "high" }],
      diffs,
      messages: [],
      parts: [],
      agents: [],
      commands: [],
      now: 120_000,
    })
    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Ship hook actions",
          constraints: "keep accepted delivery surfaces",
          acceptance: "copy and stage payloads",
        },
      },
    })
    const delivery = buildDeliveryPacket({
      title: "Integration run",
      board,
      review,
      diffs,
      now: 120_000,
    })

    const pr = buildPullRequestPayload({ sessionID: "s13", title: "Integration run", board, review, delivery, diffs })
    const ci = buildCiPayload({
      sessionID: "s14",
      title: "Empty CI",
      board: buildBoard({
        session: {
          id: "s14",
          slug: "s14",
          projectID: "p1",
          directory: "/tmp/app",
          title: "Empty CI",
          version: "1",
          time: { created: 0, updated: 0 },
        },
        status: { type: "idle" },
        todos: [],
        diffs: [],
        messages: [],
        parts: [],
        agents: [],
        commands: [],
        now: 120_000,
      }),
      review,
      delivery: buildDeliveryPacket({
        title: "Empty CI",
        board: buildBoard({
          session: {
            id: "s14",
            slug: "s14",
            projectID: "p1",
            directory: "/tmp/app",
            title: "Empty CI",
            version: "1",
            time: { created: 0, updated: 0 },
          },
          status: { type: "idle" },
          todos: [],
          diffs: [],
          messages: [],
          parts: [],
          agents: [],
          commands: [],
          now: 120_000,
        }),
        review,
        diffs: [],
        now: 120_000,
      }),
      diffs: [],
    })

    const prPrompt = buildIntegrationStagePrompt({ payload: pr })
    const ciPrompt = buildIntegrationStagePrompt({ payload: ci })

    expect(prPrompt).toContain("Stage this pull request hook from the current session.")
    expect(prPrompt).toContain("Changed files:")
    expect(prPrompt).toContain("- src/app.ts (+3/-1)")
    expect(prPrompt).toContain("Payload body:")
    expect(ciPrompt).toContain("Validation checks:")
    expect(ciPrompt).toContain("- No validation checks are attached yet.")
  })

  test("builds dashboard readiness cues from a persisted metrics fallback", () => {
    const board = buildBoard({
      session: {
        id: "s9",
        slug: "s9",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Pilot run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "idle" },
      todos: [],
      diffs: [],
      messages: [],
      parts: [],
      agents: [],
      commands: [],
      now: 120_000,
    })
    const review = buildSpecReview({
      board,
      spec: {
        ready: true,
        state: "approved",
        input: {
          goal: "Recover persisted metrics",
          constraints: "keep live-state precedence",
          acceptance: "show fallback readiness",
        },
      },
    })
    const delivery = buildDeliveryPacket({
      title: "Pilot run",
      board,
      review,
      diffs: [],
      now: 120_000,
    })
    const readiness = buildMetricsReadiness({
      board,
      review,
      delivery,
      snapshot: {
        sessionID: "s9",
        title: "Pilot run",
        updatedAt: 321,
        activation: 24,
        quality: 45,
        execution: "retry",
        verification: "blocked",
        review: "warning",
        delivery: {
          ready: 2,
          total: 4,
          files: 3,
          rollback: true,
        },
        retries: 2,
      },
    })

    expect(readiness.source).toBe("workspace")
    expect(readiness.retries).toBe(2)
    expect(readiness.files).toBe(3)
    expect(readiness.rollback).toBe(true)
    expect(readiness.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "activation", tone: "danger", detail: expect.stringContaining("only 24%") }),
        expect.objectContaining({ id: "quality", tone: "danger", detail: expect.stringContaining("only 45%") }),
        expect.objectContaining({ id: "handoff", tone: "danger", detail: expect.stringContaining("validation is blocked") }),
      ]),
    )
  })

  test("builds lightweight metric trend copy from the previous workspace snapshot", () => {
    const board = buildBoard({
      session: {
        id: "s10",
        slug: "s10",
        projectID: "p1",
        directory: "/tmp/app",
        title: "Pilot run",
        version: "1",
        time: { created: 0, updated: 0 },
      },
      status: { type: "busy" },
      todos: [
        { id: "t1", content: "Implement", status: "completed", priority: "high" },
        { id: "t2", content: "Verify", status: "in_progress", priority: "medium" },
      ],
      diffs: [{ file: "src/app.ts", before: "a", after: "b", additions: 3, deletions: 1, status: "modified" }],
      messages: [],
      parts: [],
      agents: [],
      commands: [],
      now: 120_000,
    })
    const trends = buildMetricTrends({
      board,
      source: "live",
      previous: {
        sessionID: "s9",
        title: "Earlier run",
        updatedAt: 321,
        activation: 24,
        quality: 95,
        execution: "running",
        verification: "ready",
        review: "ready",
        delivery: {
          ready: 2,
          total: 4,
          files: 1,
          rollback: true,
        },
        retries: 0,
      },
    })

    expect(trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "activation", direction: "up", delta: 26, detail: expect.stringContaining("up 26 points") }),
        expect.objectContaining({ id: "quality", direction: "down", delta: -95, detail: expect.stringContaining("down 95 points") }),
      ]),
    )
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
    const approval = buildApprovalPrompt({
      title: "Recovered run",
      focus: "Resume recovered run",
      detail: "Persisted board restored",
      next: "resume the recovered run",
      template: "Feature launch",
      playbook: "Parallel delivery",
      skills: ["Ops audit"],
      risks: ["3 changed files are already attached to the recovered snapshot", "multiple execution nodes were active in parallel"],
    })

    expect(retry).toContain("Task: Re-run tests")
    expect(retry).toContain("Parallel delivery")
    expect(playbook).toContain("Skill packs:")
    expect(playbook).toContain("- QA gate")
    expect(resume).toContain("Recovery focus: Resume recovered run")
    expect(recovery).toContain("Blocked node: Recover orchestration state")
    expect(review).toContain("Operator note: Validation evidence is attached")
    expect(approval).toContain("Request operator approval before continuing the recovered Hyperion360 run.")
    expect(approval).toContain("Next step after approval: resume the recovered run")
    expect(approval).toContain("- multiple execution nodes were active in parallel")
  })

  test("keeps recovery affordance markers in the dashboard rendering", async () => {
    const view = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()

    expect(view).toContain("Recovered run state")
    expect(view).toContain("data-recovery-state")
    expect(view).toContain("data-recovery-approval")
    expect(view).toContain("approval needed")
    expect(view).toContain("onStageRecovery")
  })

  test("keeps validation drawer markers in the dashboard rendering", async () => {
    const view = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()

    expect(view).toContain("Open validation drawer")
    expect(view).toContain("data-validation-drawer")
    expect(view).toContain("Command provenance")
    expect(view).toContain("Condensed log summary")
  })

  test("keeps spec compliance summary markers in the dashboard rendering", async () => {
    const view = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()

    expect(view).toContain("Spec compliance summary")
    expect(view).toContain("Reviewer risk list")
    expect(view).toContain("data-spec-compliance-state")
    expect(view).toContain("data-reviewer-risk")
  })

  test("keeps specialist snapshot markers in the dashboard rendering", async () => {
    const view = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()

    expect(view).toContain("data-specialist-snapshot")
    expect(view).toContain("saved specialist snapshot")
  })

  test("keeps delivery export and integration hook markers in the dashboard and review surfaces", async () => {
    const dashboard = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()
    const review = await Bun.file(new URL("./review-tab.tsx", import.meta.url)).text()
    const page = await Bun.file(new URL("../session.tsx", import.meta.url)).text()

    expect(dashboard).toContain("Delivery checklist export")
    expect(dashboard).toContain("data-delivery-export-surface")
    expect(dashboard).toContain("data-delivery-checklist")
    expect(dashboard).toContain("data-delivery-artifact")
    expect(dashboard).toContain("PR / CI / issue hooks")
    expect(dashboard).toContain("data-integration-hooks-surface")
    expect(dashboard).toContain("data-integration-hook")
    expect(review).toContain("actions={props.actions}")
    expect(page).toContain("data-integration-review-actions")
    expect(page).toContain("Copy PR")
    expect(page).toContain("Stage CI")
    expect(page).toContain("Stage issue")
    expect(page).toContain("buildIntegrationStagePrompt")
  })

  test("keeps workspace metrics snapshot markers in the dashboard rendering", async () => {
    const view = await Bun.file(new URL("../../components/session/session-dashboard.tsx", import.meta.url)).text()
    const helper = await Bun.file(new URL("./backlog.ts", import.meta.url)).text()

    expect(view).toContain("data-metrics-source")
    expect(view).toContain("data-metrics-context")
    expect(view).toContain("data-metric-trend")
    expect(view).toContain("data-metrics-readiness-source")
    expect(view).toContain("data-metrics-readiness")
    expect(view).toContain("data-operator-review-copy")
    expect(view).toContain("workspace snapshot")
    expect(view).toContain("Last workspace metrics snapshot")
    expect(view).toContain("Latest saved metrics context")
    expect(view).toContain("Operator review guidance")
    expect(view).toContain("buildMetricsReadiness")
    expect(view).toContain("buildMetricTrends")
    expect(helper).toContain("Activation tracks how much of the scoped work is materially complete.")
  })
})