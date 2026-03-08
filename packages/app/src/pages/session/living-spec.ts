import { getFilename } from "@opencode-ai/util/path"
import { createMemo, createRoot, onCleanup, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { normalizeWorkspace, sameWorkspace } from "@/utils/workspace"

const MAX_SPEC_STORES = 20
const MAX_REVISIONS = 12

export type LivingSpecInput = {
  goal: string
  constraints: string
  acceptance: string
}

export type LivingSpecRevision = {
  id: string
  version: number
  createdAt: number
  worktree: string
  input: LivingSpecInput
  draft: string
  kickoff: string
}

export type LivingSpecStore = {
  input: LivingSpecInput
  revisions: LivingSpecRevision[]
  approved?: string
  selected?: string
}

export type LivingSpecStatus = "intake" | "draft" | "approved" | "stale"

type LivingSpecSession = ReturnType<typeof createLivingSpecSession>
type LivingSpecCacheEntry = { value: LivingSpecSession; dispose: VoidFunction }

const DEFAULT_INPUT: LivingSpecInput = {
  goal: "",
  constraints: "",
  acceptance: "",
}

const DEFAULT_STORE: LivingSpecStore = {
  input: DEFAULT_INPUT,
  revisions: [],
  approved: undefined,
  selected: undefined,
}

const normalizeValue = (value: string) => value.replaceAll("\r", "").split("\n").map((line) => line.trimEnd()).join("\n").trim()

const normalizeList = (value: string) =>
  normalizeValue(value)
    .split("\n")
    .map((line) => line.replace(/^[-*•0-9.)\s]+/, "").trim())
    .filter(Boolean)

const normalizeInput = (input: LivingSpecInput): LivingSpecInput => ({
  goal: normalizeValue(input.goal),
  constraints: normalizeValue(input.constraints),
  acceptance: normalizeValue(input.acceptance),
})

const compareInput = (input: LivingSpecInput) => ({
  goal: normalizeValue(input.goal),
  constraints: normalizeList(input.constraints).join("\n"),
  acceptance: normalizeList(input.acceptance).join("\n"),
})

const bullet = (items: string[], empty: string) => (items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`)

export function hasLivingSpecInput(input: LivingSpecInput) {
  const normalized = compareInput(input)
  return !!normalized.goal || !!normalized.constraints || !!normalized.acceptance
}

export function sameLivingSpecInput(left: LivingSpecInput, right: LivingSpecInput) {
  const a = compareInput(left)
  const b = compareInput(right)
  return a.goal === b.goal && a.constraints === b.constraints && a.acceptance === b.acceptance
}

export function isLivingSpecRevisionCurrent(revision: Pick<LivingSpecRevision, "input" | "worktree"> | undefined, input: LivingSpecInput, worktree: string) {
  if (!revision) return false
  return sameWorkspace(revision.worktree, worktree) && sameLivingSpecInput(revision.input, input)
}

export function describeLivingSpecWorktree(worktree: string) {
  if (worktree === "main") return "main workspace"
  if (worktree === "create") return "create a new dedicated worktree"
  return `workspace ${getFilename(worktree)}`
}

export function buildLivingSpecDraft(input: LivingSpecInput, worktree: string) {
  const normalized = normalizeInput(input)
  return [
    "# Living spec draft",
    "",
    "## Goal",
    normalized.goal || "Goal still needs to be defined.",
    "",
    "## Constraints",
    bullet(normalizeList(normalized.constraints), "No explicit constraints recorded yet."),
    "",
    "## Acceptance criteria",
    bullet(normalizeList(normalized.acceptance), "Acceptance criteria still need to be captured."),
    "",
    "## Execution target",
    `- ${describeLivingSpecWorktree(worktree)}`,
  ].join("\n")
}

export function buildLivingSpecKickoff(input: LivingSpecInput, worktree: string) {
  const normalized = normalizeInput(input)
  return [
    "Implement the approved living spec in this repository.",
    "",
    `Goal: ${normalized.goal || "Goal still needs to be clarified."}`,
    "",
    "Constraints:",
    bullet(normalizeList(normalized.constraints), "No explicit constraints were provided."),
    "",
    "Acceptance criteria:",
    bullet(normalizeList(normalized.acceptance), "Define and satisfy clear acceptance criteria before finishing."),
    "",
    `Target workspace: ${describeLivingSpecWorktree(worktree)}.`,
    "",
    "Before making changes, briefly restate the plan. Then implement the work, run the most targeted validation, and summarize the result.",
  ].join("\n")
}

export function createLivingSpecRevision(
  input: LivingSpecInput,
  worktree: string,
  options?: { id?: string; version?: number; createdAt?: number },
): LivingSpecRevision {
  const normalized = normalizeInput(input)
  return {
    id: options?.id ?? crypto.randomUUID(),
    version: options?.version ?? 1,
    createdAt: options?.createdAt ?? Date.now(),
    worktree,
    input: normalized,
    draft: buildLivingSpecDraft(normalized, worktree),
    kickoff: buildLivingSpecKickoff(normalized, worktree),
  }
}

export function getLivingSpecStatus(store: LivingSpecStore, worktree: string) {
  const latest = store.revisions[0]
  const approved = store.approved ? store.revisions.find((revision) => revision.id === store.approved) : undefined
  const dirty = latest ? !isLivingSpecRevisionCurrent(latest, store.input, worktree) : hasLivingSpecInput(store.input)

  if (approved && !dirty) return { state: "approved" as LivingSpecStatus, dirty, latest, approved }
  if (approved) return { state: "stale" as LivingSpecStatus, dirty, latest, approved }
  if (latest) return { state: "draft" as LivingSpecStatus, dirty, latest, approved }
  return { state: "intake" as LivingSpecStatus, dirty, latest, approved }
}

function prune(cache: Map<string, LivingSpecCacheEntry>) {
  while (cache.size > MAX_SPEC_STORES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cache.get(oldest)?.dispose()
    cache.delete(oldest)
  }
}

function createLivingSpecSession(dir: string) {
  const key = normalizeWorkspace(dir)
  const legacy = [`${key}/living-spec.v1`]
  if (key !== dir) legacy.push(`${dir}/living-spec.v1`)
  const [store, setStore, _, ready] = persisted(Persist.workspace(key, "living-spec", legacy), createStore<LivingSpecStore>(DEFAULT_STORE))

  const latest = createMemo(() => store.revisions[0])
  const selected = createMemo(() => store.revisions.find((revision) => revision.id === store.selected) ?? latest())
  const approved = createMemo(() => store.revisions.find((revision) => revision.id === store.approved))

  const generate = (worktree: string) => {
    const current = latest()
    if (current && sameLivingSpecInput(current.input, store.input) && sameWorkspace(current.worktree, worktree)) {
      setStore("selected", current.id)
      return current
    }

    const revision = createLivingSpecRevision(store.input, worktree, {
      version: (current?.version ?? 0) + 1,
    })

    setStore(
      produce((draft) => {
        draft.revisions = [revision, ...draft.revisions].slice(0, MAX_REVISIONS)
        draft.selected = revision.id
        if (draft.approved && draft.approved !== revision.id) draft.approved = undefined
      }),
    )

    return revision
  }

  const approve = (id?: string) => {
    const target = id ?? selected()?.id
    const revision = store.revisions.find((item) => item.id === target) ?? selected() ?? latest()
    if (!revision) return
    setStore("approved", revision.id)
    setStore("selected", revision.id)
    return revision
  }

  return {
    ready,
    state: () => store,
    input: () => store.input,
    revisions: () => store.revisions,
    latest,
    selected,
    approved,
    setField: (key: keyof LivingSpecInput, value: string) => setStore("input", key, value),
    select: (id: string) => setStore("selected", id),
    generate,
    approve,
  }
}

export function createLivingSpec(dir: Accessor<string>) {
  const cache = new Map<string, LivingSpecCacheEntry>()

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
      value: createLivingSpecSession(directory),
      dispose,
    }))

    cache.set(key, entry)
    prune(cache)
    return entry.value
  }

  const session = createMemo(() => load(dir()))

  return {
    ready: () => session().ready(),
    state: () => session().state(),
    input: () => session().input(),
    revisions: () => session().revisions(),
    latest: () => session().latest(),
    selected: () => session().selected(),
    approved: () => session().approved(),
    setField: (key: keyof LivingSpecInput, value: string) => session().setField(key, value),
    select: (id: string) => session().select(id),
    generate: (worktree: string) => session().generate(worktree),
    approve: (id?: string) => session().approve(id),
  }
}