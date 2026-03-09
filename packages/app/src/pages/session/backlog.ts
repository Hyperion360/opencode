import { createMemo, createRoot, onCleanup, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Agent, Command, FileDiff, Message, Part, Session, SessionStatus, Todo } from "@opencode-ai/sdk/v2"
import { Persist, persisted } from "@/utils/persist"
import { normalizeWorkspace } from "@/utils/workspace"
import type { LivingSpecInput } from "./living-spec"

const MAX_KIT_STORES = 20
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

export type RunRecord = {
  sessionID: string
  title?: string
  updatedAt: number
  board: Board
  wave: SessionStatus
}

type RunStore = {
  runs: Record<string, RunRecord>
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
      checks: checks.slice(0, 5).map((part) => ({
        id: part.id,
        title: title(part.tool),
        status: part.state.status,
        detail: checkDetail(part),
        attachments: attachmentCount(part),
      })),
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

export function sameSkills(left: string[], right: string[]) {
  return sameKit(left, right)
}