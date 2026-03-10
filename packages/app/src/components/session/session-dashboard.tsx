import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/tag"
import { buildMetricTrends, buildMetricsReadiness, type Board, type DeliveryPacket, type GraphNode, type HandoffPacket, type IntegrationPayloads, type KitEvent, type KitPlaybook, type KitSkill, type KitTemplate, type MetricsSnapshot, type RunRecovery, type SpecialistFallback, type SpecReview } from "@/pages/session/backlog"

const tone = (value: string) => {
  if (value === "ready" || value === "success" || value === "completed") return "bg-emerald-500/15 text-emerald-300"
  if (value === "blocked" || value === "danger" || value === "error" || value === "cancelled") return "bg-red-500/15 text-red-200"
  if (value === "running" || value === "warning" || value === "retry" || value === "in_progress") return "bg-amber-500/15 text-amber-200"
  return "bg-background-base text-text-strong"
}

const action = (item: KitEvent) => {
  if (item.action === "applied") return "applied"
  if (item.action === "attached") return "attached"
  if (item.action === "removed") return "removed"
  return "selected"
}

const change = (value?: number, direction?: "up" | "down" | "flat" | "baseline") => {
  if (direction === "baseline") return "baseline"
  if (direction === "flat") return "steady"
  if (!value) return "steady"
  return `${value > 0 ? "+" : ""}${value} pts`
}

export function SessionDashboard(props: {
  board: Board
  handoff: HandoffPacket
  agentBoard: Board["agent"]["board"]
  specialist?: SpecialistFallback
  review: SpecReview
  delivery: DeliveryPacket
  integration: Pick<IntegrationPayloads, "pr" | "ci" | "issue">
  metrics?: MetricsSnapshot
  metricHistory?: {
    latest?: MetricsSnapshot
    previous?: MetricsSnapshot
  }
  template?: KitTemplate
  playbook?: KitPlaybook
  skills: KitSkill[]
  history: KitEvent[]
  recovery?: RunRecovery
  onRetry: (id: string) => void
  onCopyDelivery: () => void
  onCopyHandoff: () => void
  onExportDelivery: () => void
  onCopyIntegration: (kind: "pr" | "ci" | "issue") => void
  onStageHandoff: () => void
  onStageIntegration: (kind: "pr" | "ci" | "issue") => void
  onStageRecovery: () => void
  onStagePlaybook: () => void
}) {
  const [drawer, setDrawer] = createStore({
    open: false,
    id: "",
  })

  const current = createMemo(() => props.board.verification.checks.find((item) => item.id === drawer.id) ?? props.board.verification.checks[0])
  const readiness = createMemo(() => buildMetricsReadiness({ board: props.board, review: props.review, delivery: props.delivery, snapshot: props.metrics }))
  const currentMetric = createMemo(() => props.metrics ?? props.metricHistory?.latest)
  const trends = createMemo(() => buildMetricTrends({ board: props.board, previous: props.metricHistory?.previous, source: props.metrics ? "workspace" : "live" }))
  const specialistFiles = createMemo(() => Object.keys(props.specialist?.handoff?.files ?? {}).length)
  const hooks = createMemo(() => [
    {
      kind: "pr" as const,
      payload: props.integration.pr,
      detail: props.integration.pr.files[0] ?? "No changed files are attached yet.",
    },
    {
      kind: "ci" as const,
      payload: props.integration.ci,
      detail: props.integration.ci.checks[0] ?? "No validation checks are attached yet.",
    },
    {
      kind: "issue" as const,
      payload: props.integration.issue,
      detail: props.integration.issue.labels[0] ?? "No issue labels are attached yet.",
    },
  ])

  const open = (id?: string) => {
    if (!id) return
    setDrawer({ open: true, id })
  }

  return (
    <div data-component="session-dashboard" class="px-4 md:px-6 pt-2 pb-4 border-b border-border-weak bg-background-base/40 backdrop-blur-sm">
      <div class="mx-auto max-w-200 2xl:max-w-[1000px] flex flex-col gap-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-14-medium text-text-strong">Coordinator dashboard</div>
            <div class="text-12-regular text-text-weak">Execution, verification, and operator controls stay visible without leaving the session.</div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <Tag class={`px-3 py-1 ${tone(props.board.execution.state)}`}>{props.board.execution.state}</Tag>
            <Tag class={`px-3 py-1 ${tone(props.board.verification.state)}`}>{props.board.verification.label}</Tag>
            <Show when={props.template}>
              {(item) => <Tag class="px-3 py-1 bg-background-strong text-text-strong">{item().label}</Tag>}
            </Show>
          </div>
        </div>

        <Show when={props.recovery}>
          {(item) => (
            <Card class="p-4 flex flex-col gap-3" data-recovery-state={item().state} data-recovery-action={item().action.kind} data-recovery-approval={item().approval ? "needed" : "clear"}>
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div class="flex items-start gap-2">
                  <Icon name="task" size="small" />
                  <div>
                    <div class="text-14-medium text-text-strong">Recovered run state</div>
                    <div class="text-12-regular text-text-weak">{item().detail}</div>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <Tag class={`px-2 py-1 ${tone(item().tone)}`}>{item().state}</Tag>
                  <Show when={item().approval}>
                    <Tag class="px-2 py-1 bg-red-500/15 text-red-200">approval needed</Tag>
                  </Show>
                  <Tag class="px-2 py-1 bg-background-strong text-text-strong">persisted snapshot</Tag>
                </div>
              </div>
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="min-w-0">
                  <div class="text-12-medium text-text-strong">{item().approval?.title ?? item().title}</div>
                  <Show when={item().approval}>
                    {(approval) => <div class="mt-1 text-11-regular text-text-weak max-w-xl">{approval().detail}</div>}
                  </Show>
                </div>
                <Button variant="secondary" size="small" onClick={props.onStageRecovery}>
                  {item().approval?.label ?? item().action.label}
                </Button>
              </div>
            </Card>
          )}
        </Show>

        <Card class="p-4 flex flex-col gap-3" data-spec-compliance-state={props.review.state}>
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <Icon name="checklist" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Spec compliance summary</div>
                <div class="text-12-regular text-text-weak">{props.review.summary}</div>
              </div>
            </div>
            <Tag class={`px-3 py-1 ${tone(props.review.state)}`}>{props.review.label}</Tag>
          </div>
          <div class="grid gap-2 lg:grid-cols-3">
            <For each={props.review.signals}>
              {(item) => (
                <div data-spec-signal={item.id} class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-medium text-text-strong">{item.label}</div>
                    <Tag class={`px-2 py-1 ${tone(item.tone)}`}>{item.tone}</Tag>
                  </div>
                  <div class="text-11-regular text-text-weak">{item.detail}</div>
                </div>
              )}
            </For>
          </div>
          <div class="rounded-lg border border-border-weak px-3 py-3 flex flex-col gap-2 bg-background-base/60">
            <div class="text-12-medium text-text-strong">Reviewer risk list</div>
            <Show
              when={props.review.risks.length > 0}
              fallback={<div class="text-11-regular text-text-weak">No open reviewer risks are derived from the current spec, validation, and delivery signals.</div>}
            >
              <For each={props.review.risks}>
                {(item) => (
                  <div data-reviewer-risk={item.id} class="rounded-lg border border-border-weak px-3 py-2 flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-12-medium text-text-strong">{item.title}</div>
                      <div class="text-11-regular text-text-weak mt-1">{item.detail}</div>
                    </div>
                    <Tag class={`px-2 py-1 shrink-0 ${tone(item.tone)}`}>{item.tone}</Tag>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Card>

        <Card class="p-4 flex flex-col gap-3" data-delivery-export-surface>
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <Icon name="checklist" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Delivery checklist export</div>
                <div class="text-12-regular text-text-weak">{props.delivery.summary}</div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="small" onClick={props.onCopyDelivery}>
                Copy packet
              </Button>
              <Button variant="secondary" size="small" onClick={props.onExportDelivery}>
                Export packet
              </Button>
            </div>
          </div>
          <div class="grid gap-2 lg:grid-cols-2">
            <For each={props.delivery.checklist}>
              {(item) => (
                <div data-delivery-checklist={item.id} class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-medium text-text-strong">{item.label}</div>
                    <Tag class={`px-2 py-1 ${tone(item.state)}`}>{item.state}</Tag>
                  </div>
                  <div class="text-11-regular text-text-weak">{item.detail}</div>
                </div>
              )}
            </For>
          </div>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="text-12-medium text-text-strong">Artifact cards</div>
            <Tag class="px-2 py-1 bg-background-strong text-text-strong">{props.delivery.artifacts.length} cards</Tag>
          </div>
          <div class="grid gap-2 lg:grid-cols-3">
            <For each={props.delivery.artifacts}>
              {(item) => (
                <div data-delivery-artifact={item.id} class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60 flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-medium text-text-strong">{item.title}</div>
                    <Tag class={`px-2 py-1 ${tone(item.tone)}`}>{item.tone}</Tag>
                  </div>
                  <div class="text-11-regular text-text-weak">{item.detail}</div>
                  <Show when={item.facts.length > 0}>
                    <div class="flex flex-col gap-1 text-11-regular text-text-weaker">
                      <For each={item.facts}>{(fact) => <div>• {fact}</div>}</For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Card>

        <Card class="p-4 flex flex-col gap-3" data-integration-hooks-surface>
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <Icon name="share" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">PR / CI / issue hooks</div>
                <div class="text-12-regular text-text-weak">Copy or stage outbound hook payloads directly from the accepted delivery and review state.</div>
              </div>
            </div>
            <Tag class="px-2 py-1 bg-background-strong text-text-strong">demoable outbound actions</Tag>
          </div>
          <div class="grid gap-2 lg:grid-cols-3">
            <For each={hooks()}>
              {(item) => (
                <div data-integration-hook={item.kind} class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 flex flex-col gap-3">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="text-12-medium text-text-strong">{item.payload.target.label}</div>
                    <Tag class={`px-2 py-1 ${tone(item.payload.state)}`}>{item.payload.state}</Tag>
                  </div>
                  <div class="text-11-regular text-text-weak">{item.payload.target.description}</div>
                  <div class="text-11-regular text-text-weaker">{item.payload.summary}</div>
                  <div class="text-11-regular text-text-weaker">{item.detail}</div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <Button variant="ghost" size="small" data-integration-action={`${item.kind}:copy`} onClick={() => props.onCopyIntegration(item.kind)}>
                      Copy payload
                    </Button>
                    <Button variant="secondary" size="small" data-integration-action={`${item.kind}:stage`} onClick={() => props.onStageIntegration(item.kind)}>
                      Stage payload
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Card>

        <Card class="p-4 flex flex-col gap-3" data-handoff-packet-surface data-handoff-packet-source={props.handoff.source}>
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <Icon name="share" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Specialist handoff packet</div>
                <div class="text-12-regular text-text-weak">{props.handoff.summary}</div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <Tag class="px-2 py-1 bg-background-strong text-text-strong">
                {props.handoff.source === "persisted" ? "saved specialist context" : props.handoff.source === "mixed" ? "live + saved specialist context" : "live specialist context"}
              </Tag>
              <Button variant="ghost" size="small" data-handoff-action="copy" onClick={props.onCopyHandoff}>
                Copy handoff
              </Button>
              <Button variant="secondary" size="small" data-handoff-action="stage" onClick={props.onStageHandoff}>
                Stage handoff
              </Button>
            </div>
          </div>
          <div class="grid gap-2 lg:grid-cols-2">
            <div data-handoff-section="specialist" class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">Specialist identity</div>
              <For each={props.handoff.specialist}>{(item) => <div class="text-11-regular text-text-weak">• {item}</div>}</For>
            </div>
            <div data-handoff-section="memory" class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">Recent compact memory context</div>
              <Show when={props.handoff.memory.length > 0} fallback={<div class="text-11-regular text-text-weak">No compact specialist memory is attached yet.</div>}>
                <For each={props.handoff.memory}>{(item) => <div class="text-11-regular text-text-weak">• {item}</div>}</For>
              </Show>
            </div>
            <div data-handoff-section="risks" class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">Outstanding risks</div>
              <Show when={props.handoff.risks.length > 0} fallback={<div class="text-11-regular text-text-weak">No open reviewer or recovery risks are attached.</div>}>
                <For each={props.handoff.risks}>{(item) => <div class="text-11-regular text-text-weak">• {item}</div>}</For>
              </Show>
            </div>
            <div data-handoff-section="next" class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">Next actions</div>
              <For each={props.handoff.next}>{(item) => <div class="text-11-regular text-text-weak">• {item}</div>}</For>
            </div>
          </div>
        </Card>

        <div class="grid gap-4 xl:grid-cols-2">
          <Card class="p-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <Icon name="task" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Execution graph</div>
                <div class="text-12-regular text-text-weak">{props.board.execution.parallel ? "Multiple nodes are active in parallel." : "Track the current execution lane and retry failed nodes."}</div>
              </div>
            </div>
            <div class="grid gap-2 md:grid-cols-2">
              <For each={props.board.execution.nodes}>
                {(node) => (
                  <NodeCard
                    node={node}
                    onRetry={() => props.onRetry(node.id)}
                  />
                )}
              </For>
            </div>
            <Show when={props.board.execution.nodes.length === 0}>
              <div class="text-12-regular text-text-weak">Waiting for todos to stream from the session. The dashboard will expand as soon as the coordinator emits task nodes.</div>
            </Show>
          </Card>

          <Card class="p-4 flex flex-col gap-3" data-validation-open={drawer.open ? "true" : "false"}>
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2">
                <Icon name="checklist" size="small" />
                <div>
                  <div class="text-14-medium text-text-strong">Verification and delivery</div>
                  <div class="text-12-regular text-text-weak">{props.board.verification.summary}</div>
                </div>
              </div>
              <Button variant="secondary" size="small" onClick={() => open(current()?.id)} disabled={props.board.verification.checks.length === 0}>
                Open validation drawer
              </Button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-12-medium">
              <Metric label="checks" value={props.board.verification.total} />
              <Metric label="passed" value={props.board.verification.passed} />
              <Metric label="failed" value={props.board.verification.failed} />
              <Metric label="artifacts" value={props.board.verification.artifacts} />
            </div>
            <div class="grid gap-2">
              <For each={props.board.verification.checks}>
                {(check) => (
                  <div class="rounded-lg border border-border-weak px-3 py-2 flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-12-medium text-text-strong truncate">{check.title}</div>
                      <div class="text-11-regular text-text-weak">{check.detail}</div>
                      <div class="mt-1 text-11-regular text-text-weaker">{check.log.summary}</div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="small" onClick={() => open(check.id)}>
                        Inspect
                      </Button>
                      <Show when={check.attachments > 0}>
                        <Tag class="px-2 py-1 bg-background-strong text-text-strong">{check.attachments} artifacts</Tag>
                      </Show>
                      <Tag class={`px-2 py-1 ${tone(check.status)}`}>{check.status}</Tag>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <Show when={drawer.open && current()}>
              {(check) => (
                <div data-validation-drawer data-validation-check={check().id} class="rounded-lg border border-border-weak px-3 py-3 flex flex-col gap-3 bg-background-strong/40">
                  <div class="flex items-start justify-between gap-3 flex-wrap">
                    <div class="min-w-0">
                      <div class="text-12-medium text-text-strong">Validation drawer · {check().title}</div>
                      <div class="mt-1 text-11-regular text-text-weak">{check().detail}</div>
                    </div>
                    <Button variant="ghost" size="small" onClick={() => setDrawer("open", false)}>
                      Close
                    </Button>
                  </div>
                  <div class="grid gap-3 lg:grid-cols-2">
                    <div class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60">
                      <div class="text-10-medium uppercase tracking-wide text-text-weaker">Command provenance</div>
                      <div class="mt-2 text-12-medium text-text-strong break-all font-mono">{check().provenance.command}</div>
                      <div class="mt-2 flex items-center gap-2 flex-wrap text-11-regular text-text-weak">
                        <Tag class="px-2 py-1 bg-background-strong text-text-strong">{check().provenance.source}</Tag>
                        <Show when={check().provenance.agent}>
                          {(value) => <Tag class="px-2 py-1 bg-background-strong text-text-strong">agent:{value()}</Tag>}
                        </Show>
                        <Show when={check().provenance.cwd}>
                          {(value) => <Tag class="px-2 py-1 bg-background-strong text-text-strong">cwd:{value()}</Tag>}
                        </Show>
                      </div>
                      <div class="mt-2 text-11-regular text-text-weak">Call {check().provenance.call}</div>
                    </div>
                    <div class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60">
                      <div class="text-10-medium uppercase tracking-wide text-text-weaker">Condensed log summary</div>
                      <div class="mt-2 text-12-regular text-text-strong">{check().log.summary}</div>
                      <div class="mt-3 rounded-md border border-border-weak px-3 py-2 text-11-regular text-text-weak whitespace-pre-wrap break-words font-mono bg-background-base">
                        {check().log.excerpt}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Show>
          </Card>

          <Card class="p-4 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2">
                <Icon name="brain" size="small" />
                <div>
                  <div class="text-14-medium text-text-strong">Agent board and playbook</div>
                  <div class="text-12-regular text-text-weak">Active agents, attached skill packs, and reusable guidance stay visible.</div>
                </div>
              </div>
              <Button variant="secondary" size="small" onClick={props.onStagePlaybook} disabled={!props.playbook && props.skills.length === 0 && !props.template}>
                Stage playbook prompt
              </Button>
            </div>
            <div class="flex gap-2 flex-wrap">
              <Show when={props.playbook}>
                {(item) => <Tag class="px-3 py-1 bg-cyan-500/15 text-cyan-200">{item().label}</Tag>}
              </Show>
              <For each={props.skills}>{(skill) => <Tag class="px-3 py-1 bg-background-strong text-text-strong">{skill.label}</Tag>}</For>
            </div>
            <Show when={props.playbook}>
              {(item) => (
                <div class="rounded-lg border border-border-weak px-3 py-3">
                  <div class="text-12-medium text-text-strong">{item().summary}</div>
                  <div class="mt-2 flex flex-col gap-1 text-11-regular text-text-weak">
                    <For each={item().steps}>{(step, index) => <div>{index() + 1}. {step}</div>}</For>
                  </div>
                </div>
              )}
            </Show>
            <Show when={props.specialist}>
              {(item) => (
                <div data-specialist-snapshot class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60 flex flex-col gap-2">
                  <div class="flex items-center gap-2 flex-wrap text-11-regular text-text-weak">
                    <Tag class="px-2 py-1 bg-background-strong text-text-strong">
                      {item().source === "persisted" ? "saved specialist snapshot" : "live + saved specialist snapshot"}
                    </Tag>
                    <Show when={item().updatedAt}>
                      {(value) => <span>{DateTime.fromMillis(value()).toRelative() ?? "now"}</span>}
                    </Show>
                    <Show when={item().stored?.playbook}>
                      <span>saved playbook context</span>
                    </Show>
                    <Show when={(item().stored?.skills.length ?? 0) > 0}>
                      <span>{item().stored?.skills.length ?? 0} saved skill packs</span>
                    </Show>
                  </div>
                  <Show when={item().handoff?.prompt}>
                    {(value) => <div class="text-11-regular text-text-strong whitespace-pre-wrap">{value()}</div>}
                  </Show>
                  <Show when={specialistFiles() > 0}>
                    <div class="text-11-regular text-text-weak">{specialistFiles()} handoff file{specialistFiles() === 1 ? "" : "s"} restored for fallback review context.</div>
                  </Show>
                </div>
              )}
            </Show>
            <div class="grid gap-2 md:grid-cols-2">
              <For each={props.agentBoard}>
                {(agent) => (
                  <div class="rounded-lg border border-border-weak px-3 py-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-12-medium text-text-strong">{agent.name}</div>
                      <Tag class={`px-2 py-1 ${tone(agent.active ? "running" : "idle")}`}>{agent.active ? "active" : "standby"}</Tag>
                    </div>
                    <div class="mt-1 text-11-regular text-text-weak">{agent.description ?? `${agent.mode} agent with ${agent.commands} linked commands.`}</div>
                  </div>
                )}
              </For>
            </div>
          </Card>

          <Card class="p-4 flex flex-col gap-3" data-metrics-source={props.metrics ? "workspace" : "live"}>
            <div class="flex items-center gap-2">
              <Icon name="console" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Audit, rollback, and metrics</div>
                <div class="text-12-regular text-text-weak">Pilot readiness stays explicit with audit counts, retries, rollback, and recent workspace history.</div>
              </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-12-medium">
              <Metric label="audit" value={props.board.operations.audit} />
              <Metric label="retries" value={readiness().retries} />
              <Metric label="activation" value={`${props.board.operations.activation}%`} />
              <Metric label="quality" value={`${props.board.operations.quality}%`} />
            </div>
            <Show when={currentMetric()}>
              {(item) => (
                <div data-metrics-context class="flex items-center gap-2 flex-wrap text-11-regular text-text-weak">
                  <Tag class="px-2 py-1 bg-background-strong text-text-strong">{props.metrics ? "workspace snapshot" : "saved metrics context"}</Tag>
                  <span>{props.metrics ? "Last workspace metrics snapshot" : "Latest saved metrics context"}{item().title ? ` · ${item().title}` : item().sessionID ? ` · ${item().sessionID}` : ""}</span>
                  <span>{DateTime.fromMillis(item().updatedAt).toRelative() ?? "now"}</span>
                  <span>{item().execution} execution</span>
                </div>
              )}
            </Show>
            <div class="grid gap-2 lg:grid-cols-2">
              <For each={trends()}>
                {(item) => (
                  <div data-metric-trend={item.id} class="rounded-lg border border-border-weak px-3 py-3 bg-background-base/60 flex flex-col gap-2">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="text-12-medium text-text-strong">{item.label}</div>
                        <div class="text-11-regular text-text-weak">{item.explainer}</div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <div class="text-14-medium text-text-strong">{item.value}%</div>
                        <Tag class={`px-2 py-1 ${tone(item.tone)}`}>{change(item.delta, item.direction)}</Tag>
                      </div>
                    </div>
                    <div class="text-11-regular text-text-weak">{item.detail}</div>
                  </div>
                )}
              </For>
            </div>
            <div data-operator-review-copy class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 text-11-regular text-text-weak">
              <div class="text-12-medium text-text-strong">Operator review guidance</div>
              <div class="mt-2">Use activation to judge how much scoped work is materially complete. Use quality to judge whether validation and reviewer confidence are strong enough for handoff. Rising activation with stable quality is healthy progress; falling quality is a cue to pause and review before approval.</div>
            </div>
            <div class="grid gap-2 lg:grid-cols-3" data-metrics-readiness-source={readiness().source}>
              <For each={readiness().signals}>
                {(item) => (
                  <div data-metrics-readiness={item.id} class="rounded-lg border border-border-weak px-3 py-3 bg-background-strong/40 flex flex-col gap-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-12-medium text-text-strong">{item.label}</div>
                      <Tag class={`px-2 py-1 ${tone(item.tone)}`}>{item.tone}</Tag>
                    </div>
                    <div class="text-11-regular text-text-weak">{item.detail}</div>
                  </div>
                )}
              </For>
            </div>
            <div class="flex items-center gap-2 flex-wrap text-11-regular text-text-weak">
              <Tag class={`px-2 py-1 ${tone(readiness().rollback ? "ready" : "blocked")}`}>{readiness().rollback ? "rollback visible" : "rollback pending"}</Tag>
              <span>{readiness().files} changed files</span>
              <Show when={readiness().total > 0}>
                <span>{readiness().ready} / {readiness().total} delivery checks ready</span>
              </Show>
              <Show when={props.metrics} fallback={<span>{props.board.operations.duration} min elapsed</span>}>
                {(item) => <span>{item().verification} validation · {item().review} review</span>}
              </Show>
            </div>
            <div class="flex flex-col gap-2">
              <For each={props.board.activity}>
                {(item) => (
                  <div class="rounded-lg border border-border-weak px-3 py-2 flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-12-medium text-text-strong truncate">{item.title}</div>
                      <div class="text-11-regular text-text-weak">{item.detail}</div>
                    </div>
                    <Tag class={`px-2 py-1 shrink-0 ${tone(item.tone)}`}>{DateTime.fromMillis(item.at).toRelative() ?? "now"}</Tag>
                  </div>
                )}
              </For>
              <Show when={props.history.length > 0}>
                <div class="pt-1 border-t border-border-weak/80 flex flex-col gap-2">
                  <div class="text-12-medium text-text-strong">Workspace kit history</div>
                  <For each={props.history.slice(0, 4)}>
                    {(item) => (
                      <div class="flex items-center justify-between gap-3 text-11-regular text-text-weak">
                        <span>{item.label} {action(item)}</span>
                        <span>{DateTime.fromMillis(item.at).toRelative() ?? "now"}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Metric(props: { label: string; value: string | number }) {
  return (
    <div class="rounded-lg border border-border-weak px-3 py-2 bg-background-strong/60">
      <div class="text-10-medium uppercase tracking-wide text-text-weaker">{props.label}</div>
      <div class="text-14-medium text-text-strong mt-1">{props.value}</div>
    </div>
  )
}

function NodeCard(props: { node: GraphNode; onRetry: () => void }) {
  return (
    <div class="rounded-lg border border-border-weak px-3 py-3 flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong">{props.node.label}</div>
          <div class="text-11-regular text-text-weak mt-1">Priority: {props.node.priority}</div>
        </div>
        <Tag class={`px-2 py-1 shrink-0 ${tone(props.node.status)}`}>{props.node.status}</Tag>
      </div>
      <Show when={props.node.retry}>
        <Button variant="ghost" size="small" onClick={props.onRetry}>
          Retry node
        </Button>
      </Show>
    </div>
  )
}