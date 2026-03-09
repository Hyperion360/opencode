import type { IntegrationPayloads } from "@/pages/session/backlog"

type NotificationChannel = "agent" | "permissions" | "errors"

export type SessionNotificationInput = {
  payloads: IntegrationPayloads["notification"]
  reviewReady: boolean
  runFailed: boolean
  approvalNeeded: boolean
}

export type RoutedSessionNotification = {
  type: "review-ready" | "run-failed" | "approval-needed"
  channel: NotificationChannel
  title: string
  summary: string
}

export function resolveSessionNotification(input: SessionNotificationInput) {
  if (input.approvalNeeded) {
    return {
      type: "approval-needed",
      channel: "permissions",
      title: input.payloads.approvalNeeded.title,
      summary: input.payloads.approvalNeeded.summary,
    } satisfies RoutedSessionNotification
  }

  if (input.runFailed) {
    return {
      type: "run-failed",
      channel: "errors",
      title: input.payloads.runFailed.title,
      summary: input.payloads.runFailed.summary,
    } satisfies RoutedSessionNotification
  }

  if (!input.reviewReady) return
  return {
    type: "review-ready",
    channel: "agent",
    title: input.payloads.reviewReady.title,
    summary: input.payloads.reviewReady.summary,
  } satisfies RoutedSessionNotification
}

export function notificationKey(input: { type: RoutedSessionNotification["type"]; directory: string; session: string; title: string; summary: string }) {
  return [input.type, input.directory, input.session, input.title, input.summary].join("\n")
}

export function hasNotificationKey<T extends { key?: string }>(list: T[], key: string) {
  return list.some((item) => item.key === key)
}