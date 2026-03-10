const normalize = (directory: string) => directory.replace(/[\\/]+$/, "")

export function addSandbox(
  projects: { worktree: string; sandboxes?: string[] }[],
  root: string,
  directory: string,
) {
  const base = normalize(root)
  const next = normalize(directory)
  const project = projects.find((item) => normalize(item.worktree) === base)
  if (!project) return false
  const sandboxes = (project.sandboxes ?? []).filter((item) => normalize(item) !== next)
  project.sandboxes = [...sandboxes, directory]
  return true
}

type State =
  | {
      status: "pending"
    }
  | {
      status: "ready"
    }
  | {
      status: "failed"
      message: string
    }

const state = new Map<string, State>()
const waiters = new Map<
  string,
  {
    promise: Promise<State>
    resolve: (state: State) => void
  }
>()

function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

export const Worktree = {
  get(directory: string) {
    return state.get(normalize(directory))
  },
  pending(directory: string) {
    const key = normalize(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return
    state.set(key, { status: "pending" })
  },
  ready(directory: string) {
    const key = normalize(directory)
    const next = { status: "ready" } as const
    state.set(key, next)
    const waiter = waiters.get(key)
    if (!waiter) return
    waiters.delete(key)
    waiter.resolve(next)
  },
  failed(directory: string, message: string) {
    const key = normalize(directory)
    const next = { status: "failed", message } as const
    state.set(key, next)
    const waiter = waiters.get(key)
    if (!waiter) return
    waiters.delete(key)
    waiter.resolve(next)
  },
  wait(directory: string) {
    const key = normalize(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return Promise.resolve(current)

    const existing = waiters.get(key)
    if (existing) return existing.promise

    const waiter = deferred()

    waiters.set(key, waiter)
    return waiter.promise
  },
}
