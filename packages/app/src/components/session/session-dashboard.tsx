import { For, Show } from "solid-js"
import { DateTime } from "luxon"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/tag"
import type { Board, GraphNode, KitEvent, KitPlaybook, KitSkill, KitTemplate, RunRecovery } from "@/pages/session/backlog"

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

export function SessionDashboard(props: {
  board: Board
  template?: KitTemplate
  playbook?: KitPlaybook
  skills: KitSkill[]
  history: KitEvent[]
  recovery?: RunRecovery
  onRetry: (id: string) => void
  onStageRecovery: () => void
  onStagePlaybook: () => void
}) {
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

          <Card class="p-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <Icon name="checklist" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Verification and delivery</div>
                <div class="text-12-regular text-text-weak">{props.board.verification.summary}</div>
              </div>
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
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <Show when={check.attachments > 0}>
                        <Tag class="px-2 py-1 bg-background-strong text-text-strong">{check.attachments} artifacts</Tag>
                      </Show>
                      <Tag class={`px-2 py-1 ${tone(check.status)}`}>{check.status}</Tag>
                    </div>
                  </div>
                )}
              </For>
            </div>
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
            <div class="grid gap-2 md:grid-cols-2">
              <For each={props.board.agent.board}>
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

          <Card class="p-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <Icon name="console" size="small" />
              <div>
                <div class="text-14-medium text-text-strong">Audit, rollback, and metrics</div>
                <div class="text-12-regular text-text-weak">Pilot readiness stays explicit with audit counts, retries, rollback, and recent workspace history.</div>
              </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-12-medium">
              <Metric label="audit" value={props.board.operations.audit} />
              <Metric label="retries" value={props.board.operations.retries} />
              <Metric label="activation" value={`${props.board.operations.activation}%`} />
              <Metric label="quality" value={`${props.board.operations.quality}%`} />
            </div>
            <div class="flex items-center gap-2 flex-wrap text-11-regular text-text-weak">
              <Tag class={`px-2 py-1 ${tone(props.board.delivery.rollback ? "ready" : "blocked")}`}>{props.board.delivery.rollback ? "rollback visible" : "rollback pending"}</Tag>
              <span>{props.board.delivery.files} changed files</span>
              <span>{props.board.delivery.additions}+ / {props.board.delivery.deletions}-</span>
              <span>{props.board.operations.duration} min elapsed</span>
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