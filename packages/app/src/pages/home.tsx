import { createMemo, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

const flow = [
  {
    step: "01",
    title: "Intake to living spec",
    copy: "Turn goals, constraints, and acceptance criteria into a plan before execution starts.",
  },
  {
    step: "02",
    title: "Parallel implementation waves",
    copy: "Coordinate specialized agents across tasks while keeping state visible to the reviewer.",
  },
  {
    step: "03",
    title: "Verification before delivery",
    copy: "Bring tests, diffs, approvals, and handoff artifacts together before anything ships.",
  },
]

const proof = [
  "OpenCode runtime and providers stay intact so upstream improvements remain easy to adopt.",
  "The branded layer owns intake, orchestration surfaces, and delivery UX as vertical slices.",
  "Every run is designed for approval gates, auditability, and small-scope validation first.",
]

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })
  const latest = createMemo(() => recent()[0])
  const health = createMemo(() => {
    if (server.healthy() === true) return { copy: "Ready for orchestration", tone: "bg-icon-success-base" }
    if (server.healthy() === false) return { copy: "Server unavailable", tone: "bg-icon-critical-base" }
    return { copy: "Checking server health", tone: "bg-border-weak-base" }
  })
  const stats = createMemo(() => [
    { label: "Recent workspaces", value: String(sync.data.project.length) },
    { label: "Connected server", value: server.name },
    { label: "System status", value: health().copy },
  ])

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) openProject(directory)
        return
      }

      if (!result) return
      openProject(result)
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
      return
    }

    dialog.show(
      () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
      () => resolve(null),
    )
  }

  return (
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6 lg:gap-6 lg:py-8">
      <section
        class="relative overflow-hidden rounded-[32px] border border-border-weak-base bg-background-base p-6 md:p-8 lg:p-10"
        style={{
          "background-image":
            "radial-gradient(circle at top left, rgba(17, 24, 39, 0.08), transparent 28%), radial-gradient(circle at right, rgba(55, 65, 81, 0.14), transparent 32%)",
          "box-shadow": "0 24px 80px rgba(17, 24, 39, 0.08)",
        }}
      >
        <div class="absolute inset-0 bg-[linear-gradient(135deg,transparent,rgba(255,255,255,0.18))] opacity-60" />
        <div class="relative grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)] lg:gap-8">
          <div class="flex flex-col gap-5">
            <div class="flex flex-wrap items-center gap-3 text-12-medium uppercase tracking-[0.24em] text-text-weak">
              <span class="rounded-full border border-border-weak-base bg-surface-strong px-3 py-1 text-text-strong transition-transform duration-200 hover:-translate-y-0.5">
                Hyperion360.ai
              </span>
              <span>Spec-driven delivery on top of OpenCode</span>
            </div>

            <div class="max-w-3xl space-y-3">
              <h1 class="text-4xl font-semibold leading-tight tracking-tight text-text-strong md:text-5xl">
                Your AI Software Development Team
              </h1>
              <p class="max-w-2xl text-base leading-7 text-text-weak md:text-lg">
                Hyperion360.ai turns project intake into a living spec, coordinated execution, and verification-ready delivery
                without replacing the OpenCode core underneath.
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <Button size="large" class="px-4" icon="folder-add-left" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
              <Show when={latest()}>
                {(item) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="border border-border-weak-base bg-surface-strong px-4 transition-transform duration-200 hover:-translate-y-0.5"
                    onClick={() => openProject(item().worktree)}
                  >
                    Continue latest workspace
                  </Button>
                )}
              </Show>
              <div class="flex items-center gap-2 rounded-full border border-border-weak-base bg-surface-strong px-3 py-2 text-12-regular text-text-weak">
                <div class={`size-2 rounded-full ${health().tone}`} />
                {health().copy}
              </div>
            </div>

            <div class="grid gap-3 md:grid-cols-3">
              <For each={stats()}>
                {(item) => (
                  <div class="rounded-2xl border border-border-weak-base bg-surface-strong px-4 py-3 transition-transform duration-200 hover:-translate-y-0.5">
                    <div class="text-11-medium uppercase tracking-[0.2em] text-text-weaker">{item.label}</div>
                    <div class="mt-2 text-sm font-medium text-text-strong md:text-base">{item.value}</div>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-[28px] border border-border-weak-base bg-surface-weak p-5 md:p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-11-medium uppercase tracking-[0.2em] text-text-weaker">Active server</div>
                <div class="mt-2 text-lg font-medium text-text-strong">Workspace control plane</div>
              </div>
              <Button size="large" variant="ghost" class="px-3" onClick={() => dialog.show(() => <DialogSelectServer />)}>
                <div class={`size-2 rounded-full ${health().tone}`} />
                {server.name}
              </Button>
            </div>

            <div class="rounded-2xl border border-border-weak-base bg-background-base p-4">
              <div class="text-sm font-medium text-text-strong">Current MVP scope</div>
              <div class="mt-2 text-sm leading-6 text-text-weak">
                Brand the intake and orchestration surfaces first, then layer spec mode, task waves, validation, and delivery
                reporting on the existing runtime.
              </div>
            </div>

            <div class="space-y-3">
              <div class="text-sm font-medium text-text-strong">Why this approach</div>
              <ul class="space-y-2">
                <For each={proof}>
                  {(item) => (
                    <li class="flex gap-3 rounded-2xl border border-border-weak-base bg-background-base px-4 py-3 text-sm leading-6 text-text-weak">
                      <span class="mt-2 size-2 shrink-0 rounded-full bg-text-strong" />
                      <span>{item}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section class="rounded-[28px] border border-border-weak-base bg-surface-strong p-5 md:p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-11-medium uppercase tracking-[0.2em] text-text-weaker">Operating model</div>
              <h2 class="mt-2 text-2xl font-semibold tracking-tight text-text-strong">How the AI team works</h2>
            </div>
            <div class="rounded-full border border-border-weak-base bg-surface-weak px-3 py-1 text-12-regular text-text-weak">
              Vertical slice 0
            </div>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-3">
            <For each={flow}>
              {(item) => (
                <div class="rounded-[24px] border border-border-weak-base bg-background-base p-4 transition-transform duration-200 hover:-translate-y-0.5">
                  <div class="text-11-medium uppercase tracking-[0.2em] text-text-weaker">Step {item.step}</div>
                  <div class="mt-3 text-lg font-medium text-text-strong">{item.title}</div>
                  <p class="mt-2 text-sm leading-6 text-text-weak">{item.copy}</p>
                </div>
              )}
            </For>
          </div>
        </section>

        <section class="rounded-[28px] border border-border-weak-base bg-surface-strong p-5 md:p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-11-medium uppercase tracking-[0.2em] text-text-weaker">Workspace continuity</div>
              <h2 class="mt-2 text-2xl font-semibold tracking-tight text-text-strong">Recent workspaces</h2>
            </div>
            <Button variant="ghost" class="px-3" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>

          <Show
            when={recent().length > 0}
            fallback={
              <div class="mt-5 rounded-[24px] border border-dashed border-border-weak-base bg-background-base px-5 py-8 text-center">
                <div class="text-base font-medium text-text-strong">Start with a codebase</div>
                <div class="mt-2 text-sm leading-6 text-text-weak">Open a local repository to create the first Hyperion360.ai workspace.</div>
              </div>
            }
          >
            <ul class="mt-5 flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <li>
                    <Button
                      size="large"
                      variant="ghost"
                      class="w-full justify-between rounded-[20px] border border-border-weak-base bg-background-base px-4 text-left transition-transform duration-200 hover:-translate-y-0.5"
                      onClick={() => openProject(project.worktree)}
                    >
                      <div class="min-w-0">
                        <div class="truncate text-sm font-medium text-text-strong">{project.worktree.replace(homedir(), "~")}</div>
                        <div class="mt-1 text-12-regular text-text-weak">Ready to resume orchestration and review</div>
                      </div>
                      <div class="shrink-0 text-12-regular text-text-weak">
                        {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                      </div>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>
    </div>
  )
}
