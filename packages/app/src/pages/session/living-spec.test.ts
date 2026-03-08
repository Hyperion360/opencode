import { describe, expect, test } from "bun:test"
import {
  buildLivingSpecDraft,
  buildLivingSpecKickoff,
  createLivingSpecRevision,
  getLivingSpecStatus,
  isLivingSpecRevisionCurrent,
  sameLivingSpecInput,
} from "./living-spec"

describe("living spec helpers", () => {
  test("normalizes whitespace when comparing intake", () => {
    expect(
      sameLivingSpecInput(
        { goal: "Ship intake\n", constraints: "- keep core untouched", acceptance: "1. save drafts" },
        { goal: "Ship intake", constraints: "keep core untouched", acceptance: "save drafts" },
      ),
    ).toBe(true)
  })

  test("builds a readable draft with sections and bullets", () => {
    const draft = buildLivingSpecDraft(
      {
        goal: "Launch spec-first sessions",
        constraints: "- keep packages/opencode untouched\n- frontend only",
        acceptance: "1. drafts persist\n2. execution is gated",
      },
      "create",
    )

    expect(draft).toContain("# Living spec draft")
    expect(draft).toContain("Launch spec-first sessions")
    expect(draft).toContain("- keep packages/opencode untouched")
    expect(draft).toContain("- execution is gated")
    expect(draft).toContain("create a new dedicated worktree")
  })

  test("creates revisions with a deterministic kickoff prompt", () => {
    const revision = createLivingSpecRevision(
      {
        goal: "Ship Living Spec Mode",
        constraints: "frontend-only",
        acceptance: "gates execution",
      },
      "main",
      { id: "rev-1", version: 3, createdAt: 10 },
    )

    expect(revision.id).toBe("rev-1")
    expect(revision.version).toBe(3)
    expect(revision.createdAt).toBe(10)
    expect(revision.kickoff).toContain("Implement the approved living spec in this repository.")
    expect(revision.kickoff).toContain("Target workspace: main workspace.")
  })

  test("reports stale when intake changes after approval", () => {
    const revision = createLivingSpecRevision(
      {
        goal: "Ship Living Spec Mode",
        constraints: "frontend-only",
        acceptance: "gates execution",
      },
      "main",
      { id: "rev-1" },
    )

    const result = getLivingSpecStatus(
      {
        input: {
          goal: "Ship Living Spec Mode with revisions",
          constraints: "frontend-only",
          acceptance: "gates execution",
        },
        revisions: [revision],
        approved: revision.id,
        selected: revision.id,
      },
      "main",
    )

    expect(result.state).toBe("stale")
    expect(result.dirty).toBe(true)
  })

  test("treats canonicalized workspace aliases as the same revision target", () => {
    const revision = createLivingSpecRevision(
      {
        goal: "Ship Living Spec Mode",
        constraints: "frontend-only",
        acceptance: "gates execution",
      },
      "/var/tmp/spec-worktree",
    )

    expect(isLivingSpecRevisionCurrent(revision, revision.input, "/private/var/tmp/spec-worktree/")).toBe(true)
  })

  test("kickoff prompt carries goal constraints and acceptance criteria", () => {
    const kickoff = buildLivingSpecKickoff(
      {
        goal: "Improve onboarding flow",
        constraints: "no backend changes\nkeep home page copy",
        acceptance: "shows draft\napproval unlocks prompt",
      },
      "/tmp/worktrees/spec-mode",
    )

    expect(kickoff).toContain("Goal: Improve onboarding flow")
    expect(kickoff).toContain("- no backend changes")
    expect(kickoff).toContain("- approval unlocks prompt")
    expect(kickoff).toContain("workspace spec-mode")
  })
})