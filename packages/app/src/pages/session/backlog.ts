import { createMemo, createRoot, onCleanup, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Agent, Command, FileDiff, Message, Part, Session, SessionStatus, Todo } from "@opencode-ai/sdk/v2"
import { Persist, persisted } from "@/utils/persist"
import { normalizeWorkspace } from "@/utils/workspace"
import type { LivingSpecInput, LivingSpecStatus } from "./living-spec"

const MAX_KIT_STORES = 20
const MAX_METRIC_STORES = 20
const MAX_RUN_STORES = 20
const MAX_HISTORY = 24
const MAX_RUNS = 12
const checkPattern = /test|lint|type|build|check|review|verify|validate|diagnostic/i
const priorityRank = { high: 0, medium: 1, low: 2 }
const statusRank = { in_progress: 0, pending: 1, cancelled: 2, completed: 3 }

export type KitTemplate = {
  id: string
  label: string
  description: string
  input: LivingSpecInput
  playbook?: string
  skills: string[]
}

export type KitSkill = {
  id: string
  label: string
  description: string
}

export type KitPlaybook = {
  id: string
  label: string
  summary: string
  steps: string[]
}

export type KitEvent = {
  id: string
  kind: "template" | "skill" | "playbook"
  label: string
  action: "applied" | "attached" | "removed" | "selected"
  at: number
}

type KitStore = {
  template?: string
  playbook?: string
  skills: string[]
  history: KitEvent[]
}

type KitSession = ReturnType<typeof createKitSession>
type KitCacheEntry = { value: KitSession; dispose: VoidFunction }

type RunSession = ReturnType<typeof createRunSession>
type RunCacheEntry = { value: RunSession; dispose: VoidFunction }

type MetricSession = ReturnType<typeof createMetricSession>
type MetricCacheEntry = { value: MetricSession; dispose: VoidFunction }

export type GraphNode = {
  id: string
  label: string
  status: string
  priority: string
  retry: boolean
}

export type Check = {
  id: string
  title: string
  status: string
  detail: string
  attachments: number
  provenance: {
    command: string
    source: string
    agent?: string
    cwd?: string
    call: string
  }
  log: {
    summary: string
    excerpt: string
  }
}

export type AgentCard = {
  name: string
  description?: string
  mode: string
  color?: string
  active: boolean
  uses: number
  commands: number
}

export type Activity = {
  id: string
  title: string
  detail: string
  tone: "normal" | "success" | "warning" | "danger"
  at: number
}

export type Board = {
  execution: {
    total: number
    done: number
    active: number
    failed: number
    parallel: boolean
    state: "idle" | "running" | "retry"
    nodes: GraphNode[]
  }
  verification: {
    state: "idle" | "running" | "blocked" | "ready"
    label: string
    summary: string
    total: number
    passed: number
    failed: number
    pending: number
    logs: number
    artifacts: number
    checks: Check[]
  }
  delivery: {
    files: number
    additions: number
    deletions: number
    patches: number
    rollback: boolean
  }
  agent: {
    total: number
    active: number
    board: AgentCard[]
  }
  activity: Activity[]
  operations: {
    audit: number
    retries: number
    rollback: boolean
    activation: number
    quality: number
    duration: number
  }
}

export type ReviewSignal = {
  id: string
  label: string
  detail: string
  tone: Activity["tone"]
}

export type ReviewerRisk = {
  id: string
  title: string
  detail: string
  tone: Activity["tone"]
}

export type SpecReview = {
  state: "ready" | "warning" | "blocked"
  label: string
  summary: string
  signals: ReviewSignal[]
  risks: ReviewerRisk[]
}

export type DeliveryChecklist = {
  id: string
  label: string
  state: "ready" | "warning" | "blocked"
  detail: string
}

export type DeliveryArtifact = {
  id: string
  title: string
  tone: Activity["tone"]
  detail: string
  facts: string[]
}

export type DeliveryPacket = {
  title: string
  name: string
  summary: string
  checklist: DeliveryChecklist[]
  artifacts: DeliveryArtifact[]
  body: string
}

export type SpecSnapshot = {
  ready: boolean
  state?: LivingSpecStatus
  input?: LivingSpecInput
}

export type RunRecord = {
  sessionID: string
  title?: string
  updatedAt: number
  board: Board
  wave: SessionStatus
}

export type MetricsSnapshot = {
  sessionID?: string
  title?: string
  updatedAt: number
  activation: number
  quality: number
  execution: Board["execution"]["state"]
  verification: Board["verification"]["state"]
  review: SpecReview["state"]
  delivery: {
    ready: number
    total: number
    files: number
    rollback: boolean
  }
  retries: number
}

export type MetricsReadiness = {
  source: "live" | "workspace"
  retries: number
  files: number
  rollback: boolean
  ready: number
  total: number
  signals: ReviewSignal[]
}

export type RunRecovery = {
  state: "resumable" | "interrupted" | "failed" | "awaiting"
  tone: "running" | "warning" | "blocked" | "ready"
  title: string
  detail: string
  action: {
    kind: "resume" | "recover" | "review"
    label: string
  }
  node?: string
  approval?: RunApproval
}

export type RunApproval = {
  title: string
  detail: string
  label: string
  risks: string[]
}

type RunStore = {
  runs: Record<string, RunRecord>
}

type MetricsStore = {
  latest?: MetricsSnapshot
}

export const kitTemplates: KitTemplate[] = [
  {
    id: "feature-launch",
    label: "Feature launch",
    description: "Plan and ship a net-new product slice with explicit rollout guardrails.",
    input: {
      goal: "Launch a customer-facing feature end to end.",
      constraints: "Keep OpenCode core untouched. Preserve existing flows. Favor frontend and orchestration layers.",
      acceptance: "Visible UX shipped. Verification evidence captured. Rollback plan visible in workspace review.",
    },
    playbook: "parallel-delivery",
    skills: ["spec-guard", "qa-gate"],
  },
  {
    id: "bug-fix",
    label: "Bug fix",
    description: "Drive a fast reproduction, minimal fix, and proof of resolution.",
    input: {
      goal: "Resolve a regression or production bug with the smallest safe change.",
      constraints: "Avoid broad refactors. Preserve stable behavior. Capture reproduction and rollback notes.",
      acceptance: "Root cause identified. Narrow fix applied. Targeted validation passes and delivery notes explain impact.",
    },
    playbook: "safe-recovery",
    skills: ["triage", "qa-gate"],
  },
  {
    id: "pilot-polish",
    label: "Pilot polish",
    description: "Improve onboarding, review, and operator trust signals before a design-partner demo.",
    input: {
      goal: "Tighten the user journey for a pilot-ready run.",
      constraints: "Keep onboarding guided. Surface audit and retry clearly. Avoid risky backend churn.",
      acceptance: "A pilot user can onboard, run the flow, inspect artifacts, and understand recovery steps.",
    },
    playbook: "pilot-readiness",
    skills: ["spec-guard", "ops-audit"],
  },
]

export const kitSkills: KitSkill[] = [
  {
    id: "spec-guard",
    label: "Spec guard",
    description: "Keep implementation aligned with the approved spec and call out drift before delivery.",
  },
  {
    id: "qa-gate",
    label: "QA gate",
    description: "Bias the run toward tests, typechecks, and verification evidence before handoff.",
  },
  {
    id: "triage",
    label: "Bug triage",
    description: "Prioritize reproduction, impact analysis, and narrow rollback-safe changes.",
  },
  {
    id: "ops-audit",
    label: "Ops audit",
    description: "Highlight approvals, retries, tool activity, and rollback readiness for operators.",
  },
]

export const kitPlaybooks: KitPlaybook[] = [
  {
    id: "parallel-delivery",
    label: "Parallel delivery",
    summary: "Split the work into concurrent implementation and verification tracks.",
    steps: ["Approve the living spec", "Run planner + implementor tasks in parallel", "Review verification and delivery artifacts"],
  },
  {
    id: "safe-recovery",
    label: "Safe recovery",
    summary: "Contain the change, prove the fix, and keep rollback instructions obvious.",
    steps: ["Reproduce and isolate the issue", "Apply the smallest safe fix", "Re-run validation and capture rollback notes"],
  },
  {
    id: "pilot-readiness",
    label: "Pilot readiness",
    summary: "Optimize for guided onboarding, visible auditability, and stakeholder confidence.",
    steps: ["Attach pilot guardrails", "Walk through a guided run", "Review metrics, retries, and delivery evidence"],
  },
]

const defaultStore: KitStore = {
  template: undefined,
  playbook: undefined,
  skills: [],
  history: [],
}

const defaultRunStore: RunStore = {
  runs: {},
}

const defaultMetricsStore: MetricsStore = {}

const event = (kind: KitEvent["kind"], action: KitEvent["action"], label: string): KitEvent => ({
  id: crypto.randomUUID(),
  kind,
  label,
  action,
  at: Date.now(),
})

const tone = (status: string): Activity["tone"] => {
  if (status === "completed") return "success"
  if (status === "error" || status === "cancelled") return "danger"
  if (status === "running" || status === "in_progress" || status === "retry") return "warning"
  return "normal"
}

const title = (value: string) =>
  value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((item) => item[0]?.toUpperCase() + item.slice(1))
    .join(" ") || value

const messageTime = (message?: Message) => {
  if (!message) return 0
  return message.time.created
}

const cut = (value: string, size: number) => (value.length <= size ? value : `${value.slice(0, size - 1).trimEnd()}…`)

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)

const items = (value?: string) => lines(value ?? "").map((item) => item.replace(/^[-*•0-9.)\s]+/, "").trim()).filter(Boolean)

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const words = (value: unknown) => {
  if (!Array.isArray(value)) return
  const list = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
  if (list.length === 0) return
  return list.join(" ")
}

const field = (input: { [key: string]: unknown }, keys: string[]) =>
  keys.flatMap((key) => {
    const value = text(input[key])
    if (value) return [value]
    const list = words(input[key])
    return list ? [list] : []
  })[0]

const origin = (source?: Command["source"], command?: string) => {
  if (source === "skill") return "Skill command"
  if (source === "command") return "Slash command"
  if (source === "mcp") return "MCP command"
  if (command) return "Tool input"
  return "Session tool"
}

const place = (message?: Message) => {
  if (!message || message.role !== "assistant") return
  if (message.path.cwd === message.path.root) return "."
  const root = message.path.root.endsWith("/") ? message.path.root : `${message.path.root}/`
  if (!message.path.cwd.startsWith(root)) return message.path.cwd
  return message.path.cwd.slice(root.length)
}

const output = (part: Extract<Part, { type: "tool" }>) => {
  if (part.state.status === "completed") return part.state.output
  if (part.state.status === "error") return part.state.error
  if (part.state.status === "running") return part.state.title ?? ""
  return part.state.raw
}

const empty = (status: Extract<Part, { type: "tool" }>["state"]["status"]) => {
  if (status === "running") return "Live output is still streaming."
  if (status === "pending") return "Tool is queued."
  if (status === "error") return "No error output captured."
  return "No log output captured."
}

const log = (part: Extract<Part, { type: "tool" }>) => {
  const list = lines(output(part))
  if (list.length === 0) {
    const value = empty(part.state.status)
    return { summary: value, excerpt: value }
  }
  return {
    summary: cut(list.slice(0, 2).join(" · "), 180),
    excerpt: cut(list.slice(0, 4).join("\n"), 320),
  }
}

const checkDetail = (part: Extract<Part, { type: "tool" }>) => {
  if (part.state.status === "completed") return part.state.title || title(part.tool)
  if (part.state.status === "error") return part.state.error
  if (part.state.status === "running") return part.state.title || "Running"
  return "Queued"
}

const attachmentCount = (part: Extract<Part, { type: "tool" }>) => {
  if (part.state.status !== "completed") return 0
  return part.state.attachments?.length ?? 0
}

const sameKit = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index])

export function applyTemplate(template: KitTemplate) {
  return { ...template.input }
}

export function buildPlaybookPrompt(input: { template?: string; playbook?: string; skills: string[] }) {
  return [
    "Follow the selected Hyperion360 session playbook in this workspace.",
    input.template ? `Template: ${input.template}` : "Template: none selected",
    input.playbook ? `Playbook: ${input.playbook}` : "Playbook: none selected",
    "Skill packs:",
    ...(input.skills.length > 0 ? input.skills.map((item) => `- ${item}`) : ["- none attached"]),
    "",
    "Respect the approved spec, keep completed work intact, and summarize validation plus rollback readiness before handoff.",
  ].join("\n")
}

export function buildRetryPrompt(input: { node: string; template?: string; playbook?: string; skills: string[] }) {
  return [
    "Retry only the targeted execution node in the current session.",
    `Task: ${input.node}`,
    input.template ? `Template context: ${input.template}` : "Template context: none selected",
    input.playbook ? `Playbook context: ${input.playbook}` : "Playbook context: none selected",
    "Attached skill packs:",
    ...(input.skills.length > 0 ? input.skills.map((item) => `- ${item}`) : ["- none attached"]),
    "",
    "Do not restart completed work. Re-check affected files, rerun the narrowest relevant validation, and report residual risk.",
  ].join("\n")
}

export function buildResumePrompt(input: { title?: string; focus?: string; detail?: string; template?: string; playbook?: string; skills: string[] }) {
  return [
    "Resume the recovered Hyperion360 run in the current session.",
    input.title ? `Run: ${input.title}` : "Run: current session",
    input.focus ? `Recovery focus: ${input.focus}` : "Recovery focus: continue the saved execution graph",
    input.detail ? `Recovered context: ${input.detail}` : "Recovered context: persisted board state is available",
    input.template ? `Template context: ${input.template}` : "Template context: none selected",
    input.playbook ? `Playbook context: ${input.playbook}` : "Playbook context: none selected",
    "Attached skill packs:",
    ...(input.skills.length > 0 ? input.skills.map((item) => `- ${item}`) : ["- none attached"]),
    "",
    "Continue from the persisted execution graph. Do not restart completed work. First summarize what was recovered, then continue the highest-priority unfinished step and rerun the narrowest relevant validation before handoff.",
  ].join("\n")
}

export function buildRecoveryPrompt(input: {
  title?: string
  node?: string
  detail?: string
  template?: string
  playbook?: string
  skills: string[]
}) {
  return [
    "Recover the persisted Hyperion360 run in the current session.",
    input.title ? `Run: ${input.title}` : "Run: current session",
    input.node ? `Blocked node: ${input.node}` : "Blocked node: inspect the saved execution graph",
    input.detail ? `Failure context: ${input.detail}` : "Failure context: the recovered run needs another pass",
    input.template ? `Template context: ${input.template}` : "Template context: none selected",
    input.playbook ? `Playbook context: ${input.playbook}` : "Playbook context: none selected",
    "Attached skill packs:",
    ...(input.skills.length > 0 ? input.skills.map((item) => `- ${item}`) : ["- none attached"]),
    "",
    "Diagnose the saved failure, preserve completed work, retry only the unfinished or failed node, and summarize validation plus residual risk before handoff.",
  ].join("\n")
}

export function buildReviewPrompt(input: { title?: string; detail?: string; template?: string; playbook?: string; skills: string[] }) {
  return [
    "Review the recovered Hyperion360 run before delivery.",
    input.title ? `Run: ${input.title}` : "Run: current session",
    input.detail ? `Operator note: ${input.detail}` : "Operator note: the recovered run still needs review",
    input.template ? `Template context: ${input.template}` : "Template context: none selected",
    input.playbook ? `Playbook context: ${input.playbook}` : "Playbook context: none selected",
    "Attached skill packs:",
    ...(input.skills.length > 0 ? input.skills.map((item) => `- ${item}`) : ["- none attached"]),
    "",
    "Inspect the recovered diff and validation state, run the narrowest missing check or review step, and summarize whether the run is ready to hand off without restarting completed work.",
  ].join("\n")
}

export function buildApprovalPrompt(input: { title?: string; focus?: string; detail?: string; next: string; template?: string; playbook?: string; skills: string[]; risks: string[] }) {
  return [
    "Request operator approval before continuing the recovered Hyperion360 run.",
    input.title ? `Run: ${input.title}` : "Run: current session",
    input.focus ? `Checkpoint: ${input.focus}` : "Checkpoint: recovered continuation",
    input.detail ? `Recovered context: ${input.detail}` : "Recovered context: persisted board state is available",
    `Next step after approval: ${input.next}`,
    input.template ? `Template context: ${input.template}` : "Template context: none selected",
    input.playbook ? `Playbook context: ${input.playbook}` : "Playbook context: none selected",
    "Attached skill packs:",
    ...(input.skills.length > 0 ? input.skills.map((item) => `- ${item}`) : ["- none attached"]),
    "",
    "Risk signals:",
    ...(input.risks.length > 0 ? input.risks.map((item) => `- ${item}`) : ["- recovered continuation needs explicit operator approval"]),
    "",
    "Do not continue execution yet. First summarize what was recovered, explain the risk signals, and ask for explicit operator approval or a revised scope before resuming work.",
  ].join("\n")
}

const retryNode = (board: Board) => board.execution.nodes.find((item) => item.retry)?.label ?? board.execution.nodes[0]?.label

const join = (items: string[]) => {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0] ?? ""
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const signal = (id: string, label: string, detail: string, tone: ReviewSignal["tone"]) => ({
  id,
  label,
  detail,
  tone,
}) satisfies ReviewSignal

const risk = (id: string, title: string, detail: string, tone: ReviewerRisk["tone"]) => ({
  id,
  title,
  detail,
  tone,
}) satisfies ReviewerRisk

const delivery = (id: string, label: string, state: DeliveryChecklist["state"], detail: string) => ({
  id,
  label,
  state,
  detail,
}) satisfies DeliveryChecklist

const artifact = (id: string, title: string, detail: string, tone: DeliveryArtifact["tone"], facts: string[]) => ({
  id,
  title,
  detail,
  tone,
  facts,
}) satisfies DeliveryArtifact

const deliveryTone = (state: DeliveryChecklist["state"]): DeliveryArtifact["tone"] => {
  if (state === "ready") return "success"
  if (state === "blocked") return "danger"
  return "warning"
}

const sameMetricsSnapshot = (left?: MetricsSnapshot, right?: MetricsSnapshot) => {
  if (!left || !right) return left === right
  if (left.sessionID !== right.sessionID) return false
  if (left.title !== right.title) return false
  if (left.activation !== right.activation) return false
  if (left.quality !== right.quality) return false
  if (left.execution !== right.execution) return false
  if (left.verification !== right.verification) return false
  if (left.review !== right.review) return false
  if (left.delivery.ready !== right.delivery.ready) return false
  if (left.delivery.total !== right.delivery.total) return false
  if (left.delivery.files !== right.delivery.files) return false
  if (left.delivery.rollback !== right.delivery.rollback) return false
  if (left.retries !== right.retries) return false
  return true
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "session"

const approvalSignals = (board: Board) =>
  [
    board.delivery.files > 0 ? `${board.delivery.files} changed file${board.delivery.files === 1 ? " is" : "s are"} already attached to the recovered snapshot` : undefined,
    board.verification.state === "blocked" && board.delivery.files > 0 ? "verification is still blocked for the recovered diff set" : undefined,
    board.execution.parallel ? "multiple execution nodes were active in parallel" : undefined,
    board.operations.retries > 0 ? `${board.operations.retries} recovery retr${board.operations.retries === 1 ? "y was" : "ies were"} already recorded` : undefined,
    board.delivery.rollback ? "rollback artifacts are already visible" : undefined,
    board.agent.active > 1 ? `${board.agent.active} agents were active at the same time` : undefined,
  ].filter((item): item is string => !!item)

function resolveRunApproval(input: { board: Board; recovery: RunRecovery }) {
  if (input.recovery.action.kind === "review") return

  const risks = approvalSignals(input.board)
  if (risks.length === 0) return

  const next = input.recovery.action.kind === "recover" ? "starting another recovery pass" : "continuing the recovered run"

  return {
    title: "Approval needed before continuation",
    detail: `Continuing from the persisted snapshot is risky because ${join(risks)}. Stage an approval checkpoint before ${next}.`,
    label: "Stage approval checkpoint",
    risks,
  } satisfies RunApproval
}

export function buildSpecReview(input: { board: Board; spec?: SpecSnapshot }) {
  const mode = input.spec?.state
  const goal = text(input.spec?.input?.goal)
  const constraints = items(input.spec?.input?.constraints)
  const acceptance = items(input.spec?.input?.acceptance)
  const loading = !input.spec || !input.spec.ready
  const reviewing = input.board.delivery.files > 0 || input.board.execution.total > 0 || input.board.verification.total > 0 || input.board.activity.length > 0

  const drift =
    loading
      ? signal("drift", "Spec drift", "Restoring the living spec state for this workspace.", "normal")
      : mode === "approved"
        ? signal("drift", "Spec drift", "Approved living spec matches the current workspace intake.", "success")
        : mode === "stale"
          ? signal("drift", "Spec drift", "Intake changed after the last approved revision, so reviewer sign-off may no longer match the requested scope.", "danger")
          : mode === "draft"
            ? signal("drift", "Spec drift", "A draft exists, but reviewers do not have an approved baseline yet.", "warning")
            : goal || constraints.length > 0 || acceptance.length > 0
              ? signal("drift", "Spec drift", "Intake is captured, but a reviewed draft still needs to be approved.", "warning")
              : signal("drift", "Spec drift", "No living spec has been captured for this workspace yet.", reviewing ? "danger" : "warning")

  const assumptions =
    loading
      ? signal("assumptions", "Assumptions", "Loading goal, constraints, and acceptance criteria.", "normal")
      : !goal
        ? signal("assumptions", "Assumptions", "No goal is recorded for this run yet.", reviewing ? "danger" : "warning")
        : constraints.length === 0 && acceptance.length === 0
          ? signal("assumptions", "Assumptions", "Constraints and acceptance criteria are both missing, so reviewers are relying on implicit assumptions.", reviewing ? "danger" : "warning")
          : constraints.length === 0
            ? signal("assumptions", "Assumptions", "No explicit constraints are recorded for reviewers.", "warning")
            : acceptance.length === 0
              ? signal("assumptions", "Assumptions", "No acceptance criteria are recorded for reviewers.", "warning")
              : signal("assumptions", "Assumptions", `${plural(constraints.length, "constraint")} and ${acceptance.length === 1 ? "1 acceptance criterion" : `${acceptance.length} acceptance criteria`} are recorded for review.`, "success")

  const evidence =
    input.board.verification.state === "ready" && input.board.verification.total > 0
      ? signal(
          "evidence",
          "Validation evidence",
          `${input.board.verification.summary} ${input.board.verification.artifacts > 0 ? `${plural(input.board.verification.artifacts, "artifact")} attached.` : "No artifacts attached."}`,
          "success",
        )
      : input.board.verification.state === "running"
        ? signal("evidence", "Validation evidence", input.board.verification.summary, "warning")
        : input.board.verification.state === "blocked"
          ? signal("evidence", "Validation evidence", input.board.verification.summary, "danger")
          : input.board.delivery.files > 0
            ? signal("evidence", "Validation evidence", "The current diff set has no attached validation evidence yet.", "danger")
            : signal("evidence", "Validation evidence", "No delivery diff is attached yet, so reviewer evidence is still pending.", "normal")

  const risks = [
    input.spec?.ready && mode === "stale"
      ? risk(
          "stale-spec",
          "Spec drift requires a fresh approval",
          "The current intake changed after the last approved revision, so the saved approval may no longer match the requested scope.",
          "danger",
        )
      : undefined,
    input.spec?.ready && input.board.delivery.files > 0 && mode !== "approved"
      ? risk(
          "unapproved-spec",
          "Changes are present without an approved spec",
          "Reviewers can inspect the diff, but the run does not currently have an approved living spec baseline to compare against.",
          mode === "stale" ? "danger" : "warning",
        )
      : undefined,
    input.spec?.ready && constraints.length === 0
      ? risk(
          "missing-constraints",
          "Constraints are still implicit",
          "No explicit constraints are recorded, so scope and safety assumptions still need manual review before handoff.",
          "warning",
        )
      : undefined,
    input.spec?.ready && acceptance.length === 0
      ? risk(
          "missing-acceptance",
          "Acceptance evidence is underspecified",
          "The living spec does not list acceptance criteria, so reviewers do not have an explicit checklist for sign-off.",
          "warning",
        )
      : undefined,
    input.board.delivery.files > 0 && input.board.verification.total === 0
      ? risk(
          "missing-validation",
          "Validation evidence is missing",
          "The diff set is non-empty, but no tests, typechecks, or review commands are attached to this run.",
          "danger",
        )
      : undefined,
    input.board.verification.failed > 0
      ? risk("failed-validation", "Validation failures remain open", input.board.verification.summary, "danger")
      : undefined,
    input.board.verification.pending > 0
      ? risk("pending-validation", "Validation is still in flight", input.board.verification.summary, "warning")
      : undefined,
    input.board.operations.retries > 0
      ? risk(
          "retries",
          "Recovered execution needs reviewer attention",
          `${plural(input.board.operations.retries, "recovery or retry signal")} were recorded for this run. Inspect why the run needed another pass before handoff.`,
          "warning",
        )
      : undefined,
    input.board.delivery.files > 0 && !input.board.delivery.rollback
      ? risk(
          "rollback",
          "Rollback path is not visible yet",
          "The run has attached changes, but rollback evidence is not yet surfaced in the delivery panel.",
          "warning",
        )
      : undefined,
    input.board.execution.parallel || input.board.agent.active > 1
      ? risk(
          "parallel",
          "Parallel execution widened the review surface",
          "Multiple nodes or agents were active in parallel, so reviewers should confirm combined output and validation coverage.",
          "warning",
        )
      : undefined,
  ].filter((item): item is ReviewerRisk => !!item)

  const signals = [drift, assumptions, evidence]
  const blocked = signals.some((item) => item.tone === "danger") || risks.some((item) => item.tone === "danger")
  const warning = loading || signals.some((item) => item.tone === "warning") || risks.length > 0
  const state = blocked ? "blocked" : warning ? "warning" : "ready"
  const label = state === "blocked" ? "Review blocked" : state === "warning" ? "Review needs attention" : "Review aligned"
  const summary =
    state === "ready"
      ? "Approved scope, explicit assumptions, and attached validation evidence leave no open reviewer risks."
      : state === "blocked"
        ? risks.length > 0
          ? `${plural(risks.length, "reviewer risk")} need attention before handoff.`
          : "The current spec or validation signals are not strong enough for reviewer handoff yet."
        : loading
          ? "Restoring spec context and reviewer signals for this workspace."
          : risks.length > 0
            ? `${plural(risks.length, "reviewer risk")} still need confirmation before handoff.`
            : "Review signals are partially complete; confirm the remaining spec context before handoff."

  return {
    state,
    label,
    summary,
    signals,
    risks,
  } satisfies SpecReview
}

export function buildDeliveryPacket(input: { title?: string; board: Board; review: SpecReview; diffs: FileDiff[]; now?: number }) {
  const title = text(input.title) ?? "Session delivery packet"
  const stamp = new Date(input.now ?? Date.now()).toISOString()
  const verifyState =
    input.board.verification.state === "ready"
      ? "ready"
      : input.board.verification.state === "blocked"
        ? "blocked"
        : "warning"
  const handoffState =
    input.review.risks.some((item) => item.tone === "danger")
      ? "blocked"
      : input.review.risks.length > 0 || !input.board.delivery.rollback
        ? "warning"
        : "ready"
  const spec = delivery("spec", "Spec review", input.review.state, `${input.review.label}. ${input.review.summary}`)
  const validation = delivery("validation", "Validation evidence", verifyState, input.board.verification.summary)
  const changes = delivery(
    "changes",
    "Diff package",
    input.board.delivery.files > 0 ? "ready" : "warning",
    input.board.delivery.files > 0
      ? `${plural(input.board.delivery.files, "changed file")} attached with ${input.board.delivery.additions}+ / ${input.board.delivery.deletions}-.`
      : "No changed files are attached to the current handoff yet.",
  )
  const handoff = delivery(
    "handoff",
    "Handoff context",
    handoffState,
    input.review.risks.length > 0
      ? `${plural(input.review.risks.length, "reviewer risk")} remain open before handoff.`
      : input.board.delivery.rollback
        ? "Rollback visibility and reviewer context are both present."
        : "Reviewer context is present, but rollback evidence is not visible yet.",
  )
  const checklist = [spec, validation, changes, handoff]
  const artifacts = [
    artifact(
      "diffs",
      "Diff summary",
      input.board.delivery.files > 0
        ? `${plural(input.board.delivery.files, "file")} changed with ${input.board.delivery.additions} additions and ${input.board.delivery.deletions} deletions.`
        : "No delivery diff is attached yet.",
      deliveryTone(changes.state),
      input.diffs.slice(0, 4).map((item) => `${item.file} (+${item.additions}/-${item.deletions})`),
    ),
    artifact(
      "validation",
      "Validation evidence",
      `${input.board.verification.summary} ${input.board.verification.artifacts > 0 ? `${plural(input.board.verification.artifacts, "artifact")} are visible.` : "No artifacts are attached."}`,
      deliveryTone(validation.state),
      input.board.verification.checks.slice(0, 4).map((item) => `${item.title}: ${item.status}${item.attachments > 0 ? ` · ${item.attachments} artifacts` : ""}`),
    ),
    artifact(
      "handoff",
      "Handoff context",
      input.review.summary,
      deliveryTone(handoff.state),
      input.review.risks.length > 0
        ? input.review.risks.slice(0, 4).map((item) => item.title)
        : input.review.signals.slice(0, 3).map((item) => `${item.label}: ${item.tone}`),
    ),
  ]
  const ready = checklist.filter((item) => item.state === "ready").length
  const summary = `${ready} of ${checklist.length} delivery checks are ready.`
  const body = [
    `# ${title}`,
    "",
    `Generated: ${stamp}`,
    `Summary: ${summary}`,
    "",
    "## Delivery checklist",
    ...checklist.map((item) => `- ${item.state.toUpperCase()} · ${item.label}: ${item.detail}`),
    "",
    "## Artifact cards",
    ...artifacts.flatMap((item) => [
      `### ${item.title}`,
      item.detail,
      ...(item.facts.length > 0 ? item.facts.map((fact) => `- ${fact}`) : ["- No artifact highlights attached."]),
      "",
    ]),
    "## Validation checks",
    ...(input.board.verification.checks.length > 0
      ? input.board.verification.checks.map((item) => `- ${item.title} · ${item.status} · ${item.detail}`)
      : ["- No validation checks are attached yet."]),
    "",
    "## Changed files",
    ...(input.diffs.length > 0
      ? input.diffs.slice(0, 20).map((item) => `- ${item.file} (+${item.additions}/-${item.deletions})`)
      : ["- No changed files are attached yet."]),
    ...(input.diffs.length > 20 ? [`- ${input.diffs.length - 20} additional files omitted from this export.`] : []),
  ].join("\n")

  return {
    title,
    name: `${slug(title)}-delivery-packet.md`,
    summary,
    checklist,
    artifacts,
    body,
  } satisfies DeliveryPacket
}

export function buildMetricsSnapshot(input: {
  sessionID?: string
  title?: string
  board: Board
  review: SpecReview
  delivery: DeliveryPacket
  now?: number
}) {
  return {
    sessionID: input.sessionID,
    title: input.title,
    updatedAt: input.now ?? Date.now(),
    activation: input.board.operations.activation,
    quality: input.board.operations.quality,
    execution: input.board.execution.state,
    verification: input.board.verification.state,
    review: input.review.state,
    delivery: {
      ready: input.delivery.checklist.filter((item) => item.state === "ready").length,
      total: input.delivery.checklist.length,
      files: input.board.delivery.files,
      rollback: input.board.delivery.rollback,
    },
    retries: input.board.operations.retries,
  } satisfies MetricsSnapshot
}

export function buildMetricsReadiness(input: { board: Board; review: SpecReview; delivery: DeliveryPacket; snapshot?: MetricsSnapshot }) {
  const source = input.snapshot ? "workspace" : "live"
  const label = source === "workspace" ? "Persisted workspace snapshot" : "Current session state"
  const activation = input.snapshot?.activation ?? input.board.operations.activation
  const quality = input.snapshot?.quality ?? input.board.operations.quality
  const verification = input.snapshot?.verification ?? input.board.verification.state
  const review = input.snapshot?.review ?? input.review.state
  const ready = input.snapshot?.delivery.ready ?? input.delivery.checklist.filter((item) => item.state === "ready").length
  const total = input.snapshot?.delivery.total ?? input.delivery.checklist.length
  const files = input.snapshot?.delivery.files ?? input.board.delivery.files
  const rollback = input.snapshot?.delivery.rollback ?? input.board.delivery.rollback
  const retries = input.snapshot?.retries ?? input.board.operations.retries
  const handoff =
    total > 0 && ready === total && verification === "ready" && review === "ready" && rollback
      ? signal("handoff", "Delivery handoff", `All ${total} delivery checks are ready, rollback is visible, and the handoff packet can move to review.`, "success")
      : verification === "blocked" || review === "blocked"
        ? signal(
            "handoff",
            "Delivery handoff",
            `${label} still needs operator follow-up because validation is ${verification} and review is ${review}.`,
            "danger",
          )
        : total === 0 && files === 0
          ? signal("handoff", "Delivery handoff", `${label} does not have a delivery packet attached yet, so readiness still depends on a fresh validation pass.`, "warning")
          : signal(
              "handoff",
              "Delivery handoff",
              `${ready} of ${total} delivery checks are ready, ${plural(retries, "retry")} are recorded${rollback ? ", and rollback is visible." : ", but rollback evidence is still pending."}`,
              "warning",
            )

  return {
    source,
    retries,
    files,
    rollback,
    ready,
    total,
    signals: [
      activation >= 80
        ? signal("activation", "Activation readiness", `${label} keeps activation at ${activation}%, so the run is materially complete.`, "success")
        : activation >= 50
          ? signal("activation", "Activation readiness", `${label} keeps activation at ${activation}%, so more execution still needs to land before handoff.`, "warning")
          : signal("activation", "Activation readiness", `${label} keeps activation at only ${activation}%, so the run is not ready for handoff yet.`, "danger"),
      quality >= 85
        ? signal("quality", "Quality guardrail", `${label} keeps quality at ${quality}% with validation ${verification} and review ${review}.`, "success")
        : quality >= 60
          ? signal("quality", "Quality guardrail", `${label} keeps quality at ${quality}%, so validation and review follow-up are still in flight.`, "warning")
          : signal("quality", "Quality guardrail", `${label} keeps quality at only ${quality}%, so validation or reviewer confidence is still too weak for handoff.`, "danger"),
      handoff,
    ],
  } satisfies MetricsReadiness
}

export function buildBoard(input: {
  session?: Session
  status: SessionStatus
  todos: Todo[]
  diffs: FileDiff[]
  messages: Message[]
  parts: Part[]
  agents: Agent[]
  commands: Command[]
  now?: number
}) {
  const now = input.now ?? Date.now()
  const notes = input.todos
    .slice()
    .sort((left, right) => {
      const leftStatus = statusRank[left.status as keyof typeof statusRank] ?? 9
      const rightStatus = statusRank[right.status as keyof typeof statusRank] ?? 9
      if (leftStatus !== rightStatus) return leftStatus - rightStatus
      const leftPriority = priorityRank[left.priority as keyof typeof priorityRank] ?? 9
      const rightPriority = priorityRank[right.priority as keyof typeof priorityRank] ?? 9
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return left.content.localeCompare(right.content)
    })
    .map((todo) => ({
      id: todo.id,
      label: todo.content,
      status: todo.status,
      priority: todo.priority,
      retry: todo.status === "cancelled",
    }))

  const tools = input.parts.filter((part): part is Extract<Part, { type: "tool" }> => part.type === "tool")
  const checks = tools.filter((part) => checkPattern.test(part.tool))
  const patches = input.parts.filter((part): part is Extract<Part, { type: "patch" }> => part.type === "patch")
  const retries = input.parts.filter((part): part is Extract<Part, { type: "retry" }> => part.type === "retry")
  const agentParts = input.parts.filter((part): part is Extract<Part, { type: "agent" }> => part.type === "agent")
  const subtasks = input.parts.filter((part): part is Extract<Part, { type: "subtask" }> => part.type === "subtask")
  const finishes = input.parts.filter((part): part is Extract<Part, { type: "step-finish" }> => part.type === "step-finish")
  const byMessage = new Map(input.messages.map((message) => [message.id, message]))
  const byCommand = new Map(input.commands.map((command) => [command.name.toLowerCase(), command]))
  const passed = checks.filter((part) => part.state.status === "completed").length
  const failed = checks.filter((part) => part.state.status === "error").length
  const pending = checks.filter((part) => part.state.status === "pending" || part.state.status === "running").length
  const needsVerification = input.diffs.length > 0 && checks.length === 0
  const verifyState = pending > 0 || input.status.type === "busy" ? "running" : failed > 0 || needsVerification ? "blocked" : checks.length > 0 ? "ready" : "idle"
  const verifyLabel =
    verifyState === "running"
      ? "Verification in progress"
      : verifyState === "blocked"
        ? "Delivery blocked"
        : verifyState === "ready"
          ? "Ready for delivery"
          : "Awaiting verification"
  const verifySummary =
    failed > 0
      ? `${failed} validation run${failed === 1 ? "" : "s"} failed.`
      : needsVerification
        ? "No validation evidence is attached to the current diff set."
        : passed > 0
          ? `${passed} validation run${passed === 1 ? "" : "s"} passed.`
          : "Run tests, typechecks, or review commands to unlock delivery readiness."

  const agentCounts = input.messages
    .filter((message): message is Extract<Message, { role: "assistant" }> => message.role === "assistant")
    .map((message) => message.agent)
    .concat(agentParts.map((part) => part.name), subtasks.map((part) => part.agent))
    .reduce((acc, name) => {
      acc.set(name, (acc.get(name) ?? 0) + 1)
      return acc
    }, new Map<string, number>())

  const agentBoard = input.agents
    .filter((agent) => !agent.hidden)
    .map((agent) => ({
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
      color: agent.color,
      active: (agentCounts.get(agent.name) ?? 0) > 0,
      uses: agentCounts.get(agent.name) ?? 0,
      commands: input.commands.filter((command) => command.agent === agent.name).length,
    }))
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1
      if (left.uses !== right.uses) return right.uses - left.uses
      return left.name.localeCompare(right.name)
    })

  const activity: Activity[] = [
    ...tools.map<Activity>((part) => ({
      id: part.id,
      title: `Tool · ${title(part.tool)}`,
      detail: checkDetail(part),
      tone: tone(part.state.status),
      at:
        part.state.status === "running"
          ? part.state.time.start
          : part.state.status === "completed"
            ? part.state.time.end
            : part.state.status === "error"
              ? part.state.time.end
              : messageTime(byMessage.get(part.messageID)),
    })),
    ...patches.map<Activity>((part) => ({
      id: part.id,
      title: `Patch · ${part.files.length} file${part.files.length === 1 ? "" : "s"}`,
      detail: part.files[0] ?? "Patch recorded",
      tone: "success" as const,
      at: messageTime(byMessage.get(part.messageID)),
    })),
    ...retries.map<Activity>((part) => ({
      id: part.id,
      title: `Retry · attempt ${part.attempt}`,
      detail: part.error.data.message || "Retry requested",
      tone: "warning" as const,
      at: part.time.created,
    })),
    ...agentParts.map<Activity>((part) => ({
      id: part.id,
      title: `Agent · ${part.name}`,
      detail: "Delegated work surfaced in the run log.",
      tone: "normal" as const,
      at: messageTime(byMessage.get(part.messageID)),
    })),
    ...finishes.map<Activity>((part) => ({
      id: part.id,
      title: "Step finished",
      detail: part.reason,
      tone: part.reason === "complete" ? "success" : "normal",
      at: messageTime(byMessage.get(part.messageID)),
    })),
  ]
    .sort((left, right) => right.at - left.at)
    .slice(0, 10)

  const additions = input.diffs.reduce((sum, diff) => sum + diff.additions, 0)
  const deletions = input.diffs.reduce((sum, diff) => sum + diff.deletions, 0)
  const done = notes.filter((todo) => todo.status === "completed").length
  const active = notes.filter((todo) => todo.status === "in_progress").length
  const failedNodes = notes.filter((todo) => todo.status === "cancelled").length
  const duration = input.session ? Math.max(0, Math.round((now - input.session.time.created) / 60_000)) : 0
  const activation = notes.length === 0 ? 0 : Math.round((done / notes.length) * 100)
  const qualityBase = checks.length === 0 ? (input.diffs.length > 0 ? 0 : 100) : Math.max(0, Math.round((passed / checks.length) * 100) - failed * 15)

  return {
    execution: {
      total: notes.length,
      done,
      active,
      failed: failedNodes,
      parallel: active > 1,
      state: input.status.type === "retry" ? "retry" : input.status.type === "busy" || active > 0 ? "running" : "idle",
      nodes: notes,
    },
    verification: {
      state: verifyState,
      label: verifyLabel,
      summary: verifySummary,
      total: checks.length,
      passed,
      failed,
      pending,
      logs: tools.length,
      artifacts: checks.reduce((sum, part) => sum + attachmentCount(part), 0) + patches.length,
      checks: checks.slice(0, 5).map((part) => {
        const tool = part.tool.toLowerCase()
        const message = byMessage.get(part.messageID)
        const command = byCommand.get(tool)
        const value = part.state.status === "pending" ? text(part.state.raw) : field(part.state.input, ["command", "cmd", "script", "arguments", "args"])
        return {
          id: part.id,
          title: title(part.tool),
          status: part.state.status,
          detail: checkDetail(part),
          attachments: attachmentCount(part),
          provenance: {
            command: value ?? (command?.name ? `/${command.name}` : title(part.tool)),
            source: origin(command?.source, value),
            agent: message?.role === "assistant" ? message.agent : command?.agent,
            cwd: place(message),
            call: part.callID,
          },
          log: log(part),
        }
      }),
    },
    delivery: {
      files: input.diffs.length,
      additions,
      deletions,
      patches: patches.length,
      rollback: !!input.session?.revert?.messageID || patches.length > 0,
    },
    agent: {
      total: agentBoard.length,
      active: agentBoard.filter((agent) => agent.active).length,
      board: agentBoard.slice(0, 6),
    },
    activity,
    operations: {
      audit: tools.length + agentParts.length + retries.length,
      retries: retries.length + (input.status.type === "retry" ? 1 : 0),
      rollback: !!input.session?.revert?.messageID || patches.length > 0,
      activation,
      quality: Math.max(0, qualityBase),
      duration,
    },
  } satisfies Board
}

export function hasRunState(input: { board: Board; status: SessionStatus }) {
  if (input.status.type !== "idle") return true
  if (input.board.execution.total > 0) return true
  if (input.board.execution.state !== "idle") return true
  if (input.board.activity.length > 0) return true
  if (input.board.verification.total > 0) return true
  if (input.board.delivery.files > 0) return true
  if (input.board.delivery.patches > 0) return true
  return false
}

export function resolveMetricsSnapshot(input: { board: Board; snapshot?: MetricsSnapshot; status: SessionStatus }) {
  if (!input.snapshot) return
  if (hasRunState({ board: input.board, status: input.status })) return
  return input.snapshot
}

export function resolveMetricBoard(input: { board: Board; snapshot?: MetricsSnapshot; status: SessionStatus }) {
  const snapshot = resolveMetricsSnapshot(input)
  if (!snapshot) return input.board
  return {
    ...input.board,
    operations: {
      ...input.board.operations,
      activation: snapshot.activation,
      quality: snapshot.quality,
    },
  } satisfies Board
}

export function buildRunRecord(input: {
  sessionID: string
  title?: string
  updatedAt?: number
  board: Board
  wave: SessionStatus
}) {
  return {
    sessionID: input.sessionID,
    title: input.title,
    updatedAt: input.updatedAt ?? Date.now(),
    board: input.board,
    wave: input.wave,
  } satisfies RunRecord
}

export function resolveRunBoard(input: { live: Board; record?: RunRecord; status: SessionStatus }) {
  if (!input.record) return input.live
  if (hasRunState({ board: input.live, status: input.status })) return input.live
  return input.record.board
}

export function resolveRunRecovery(input: { live: Board; record?: RunRecord; status: SessionStatus }) {
  if (!input.record) return
  if (hasRunState({ board: input.live, status: input.status })) return

  const board = input.record.board
  const node = retryNode(board)
  const attachApproval = (recovery: RunRecovery) => {
    const approval = resolveRunApproval({ board, recovery })
    if (!approval) return recovery
    return {
      ...recovery,
      approval,
    } satisfies RunRecovery
  }

  if (input.record.wave.type === "retry" || board.execution.state === "retry" || board.execution.failed > 0 || board.verification.failed > 0) {
    return attachApproval({
      state: "failed",
      tone: "blocked",
      title: "Recovery required",
      detail:
        input.record.wave.type === "retry"
          ? input.record.wave.message
          : node
            ? `${node} needs another recovery pass before the run can continue.`
            : "The recovered run needs a focused recovery pass before it can continue.",
      action: {
        kind: "recover",
        label: "Stage recovery prompt",
      },
      node,
    } satisfies RunRecovery)
  }

  if (input.record.wave.type === "busy" || board.execution.state === "running" || board.execution.active > 0) {
    return attachApproval({
      state: "resumable",
      tone: "running",
      title: "Resume recovered run",
      detail: "Live session state is empty, but the persisted board shows work was still in flight. Continue from the saved orchestration context without restarting completed work.",
      action: {
        kind: "resume",
        label: "Stage resume prompt",
      },
      node,
    } satisfies RunRecovery)
  }

  if (board.verification.state === "ready" || board.verification.state === "blocked" || board.delivery.files > 0) {
    return {
      state: "awaiting",
      tone: board.verification.state === "ready" ? "ready" : "warning",
      title: board.verification.state === "ready" ? "Awaiting delivery review" : "Awaiting operator action",
      detail:
        board.verification.state === "ready"
          ? "Validation evidence is attached to the recovered run. Review the persisted snapshot and hand off without restarting completed work."
          : "The recovered run still needs validation or delivery follow-up before it is safe to hand off.",
      action: {
        kind: "review",
        label: board.verification.state === "ready" ? "Stage review prompt" : "Stage verification prompt",
      },
      node,
    } satisfies RunRecovery
  }

  if (!hasRunState({ board, status: input.record.wave })) return

  return attachApproval({
    state: "interrupted",
    tone: "warning",
    title: "Recovered snapshot ready",
    detail: "Live session state is empty, but the last persisted board was restored. Review the saved execution state and resume the next unfinished step.",
    action: {
      kind: "resume",
      label: "Stage resume prompt",
    },
    node,
  } satisfies RunRecovery)
}

function pruneRuns(runs: Record<string, RunRecord>) {
  return Object.fromEntries(
    Object.values(runs)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_RUNS)
      .map((item) => [item.sessionID, item] as const),
  )
}

function pruneRunCache(cache: Map<string, RunCacheEntry>) {
  while (cache.size > MAX_RUN_STORES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cache.get(oldest)?.dispose()
    cache.delete(oldest)
  }
}

function pruneMetricCache(cache: Map<string, MetricCacheEntry>) {
  while (cache.size > MAX_METRIC_STORES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cache.get(oldest)?.dispose()
    cache.delete(oldest)
  }
}

function createRunSession(dir: string) {
  const key = normalizeWorkspace(dir)
  const legacy = [`${key}/hyperion360-runs.v1`]
  if (key !== dir) legacy.push(`${dir}/hyperion360-runs.v1`)
  const [store, setStore, _, ready] = persisted(Persist.workspace(key, "hyperion360-runs", legacy), createStore<RunStore>(defaultRunStore))

  return {
    ready,
    state: () => store,
    run: (sessionID: string) => store.runs[sessionID],
    remember: (record: RunRecord) =>
      setStore(
        produce((draft) => {
          draft.runs[record.sessionID] = record
          draft.runs = pruneRuns(draft.runs)
        }),
      ),
  }
}

function createMetricSession(dir: string) {
  const key = normalizeWorkspace(dir)
  const legacy = [`${key}/hyperion360-metrics.v1`]
  if (key !== dir) legacy.push(`${dir}/hyperion360-metrics.v1`)
  const [store, setStore, _, ready] = persisted(Persist.workspace(key, "hyperion360-metrics", legacy), createStore<MetricsStore>(defaultMetricsStore))

  return {
    ready,
    state: () => store,
    latest: () => store.latest,
    remember: (snapshot: MetricsSnapshot) =>
      setStore(
        produce((draft) => {
          if (sameMetricsSnapshot(draft.latest, snapshot)) return
          draft.latest = snapshot
        }),
      ),
  }
}

function prune(cache: Map<string, KitCacheEntry>) {
  while (cache.size > MAX_KIT_STORES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cache.get(oldest)?.dispose()
    cache.delete(oldest)
  }
}

function createKitSession(dir: string) {
  const key = normalizeWorkspace(dir)
  const legacy = [`${key}/session-kit.v1`]
  if (key !== dir) legacy.push(`${dir}/session-kit.v1`)
  const [store, setStore, _, ready] = persisted(Persist.workspace(key, "session-kit", legacy), createStore<KitStore>(defaultStore))

  const remember = (item: KitEvent) =>
    setStore(
      produce((draft) => {
        draft.history = [item, ...draft.history].slice(0, MAX_HISTORY)
      }),
    )

  const attachSkill = (id: string) => {
    const skill = kitSkills.find((item) => item.id === id)
    if (!skill) return
    if (store.skills.includes(id)) return
    setStore("skills", (skills) => [...skills, id].sort())
    remember(event("skill", "attached", skill.label))
  }

  return {
    ready,
    state: () => store,
    template: () => store.template,
    playbook: () => store.playbook,
    skills: () => store.skills,
    history: () => store.history,
    selectTemplate: (id: string) => {
      const template = kitTemplates.find((item) => item.id === id)
      if (!template) return
      setStore("template", id)
      remember(event("template", "applied", template.label))
    },
    selectPlaybook: (id: string) => {
      const playbook = kitPlaybooks.find((item) => item.id === id)
      if (!playbook) return
      setStore("playbook", id)
      remember(event("playbook", "selected", playbook.label))
    },
    attachSkill,
    toggleSkill: (id: string) => {
      const skill = kitSkills.find((item) => item.id === id)
      if (!skill) return
      if (store.skills.includes(id)) {
        setStore(
          "skills",
          (skills) => skills.filter((item) => item !== id),
        )
        remember(event("skill", "removed", skill.label))
        return
      }
      attachSkill(id)
    },
  }
}

export function createWorkspaceKit(dir: Accessor<string>) {
  const cache = new Map<string, KitCacheEntry>()

  onCleanup(() => {
    for (const entry of cache.values()) entry.dispose()
    cache.clear()
  })

  const load = (directory: string) => {
    const key = normalizeWorkspace(directory)
    const existing = cache.get(key)
    if (existing) {
      cache.delete(key)
      cache.set(key, existing)
      return existing.value
    }

    const entry = createRoot((dispose) => ({
      value: createKitSession(directory),
      dispose,
    }))
    cache.set(key, entry)
    prune(cache)
    return entry.value
  }

  const state = createMemo(() => load(dir()))

  return {
    ready: () => state().ready(),
    state: () => state().state(),
    template: () => state().template(),
    playbook: () => state().playbook(),
    skills: () => state().skills(),
    history: () => state().history(),
    selectTemplate: (id: string) => state().selectTemplate(id),
    selectPlaybook: (id: string) => state().selectPlaybook(id),
    attachSkill: (id: string) => state().attachSkill(id),
    toggleSkill: (id: string) => state().toggleSkill(id),
  }
}

export function createWorkspaceRuns(dir: Accessor<string>) {
  const cache = new Map<string, RunCacheEntry>()

  onCleanup(() => {
    for (const entry of cache.values()) entry.dispose()
    cache.clear()
  })

  const load = (directory: string) => {
    const key = normalizeWorkspace(directory)
    const existing = cache.get(key)
    if (existing) {
      cache.delete(key)
      cache.set(key, existing)
      return existing.value
    }

    const entry = createRoot((dispose) => ({
      value: createRunSession(directory),
      dispose,
    }))
    cache.set(key, entry)
    pruneRunCache(cache)
    return entry.value
  }

  const state = createMemo(() => load(dir()))

  return {
    ready: () => state().ready(),
    state: () => state().state(),
    run: (sessionID: string) => state().run(sessionID),
    remember: (record: RunRecord) => state().remember(record),
  }
}

export function createWorkspaceMetrics(dir: Accessor<string>) {
  const cache = new Map<string, MetricCacheEntry>()

  onCleanup(() => {
    for (const entry of cache.values()) entry.dispose()
    cache.clear()
  })

  const load = (directory: string) => {
    const key = normalizeWorkspace(directory)
    const existing = cache.get(key)
    if (existing) {
      cache.delete(key)
      cache.set(key, existing)
      return existing.value
    }

    const entry = createRoot((dispose) => ({
      value: createMetricSession(directory),
      dispose,
    }))
    cache.set(key, entry)
    pruneMetricCache(cache)
    return entry.value
  }

  const state = createMemo(() => load(dir()))

  return {
    ready: () => state().ready(),
    state: () => state().state(),
    latest: () => state().latest(),
    remember: (snapshot: MetricsSnapshot) => state().remember(snapshot),
  }
}

export function sameSkills(left: string[], right: string[]) {
  return sameKit(left, right)
}