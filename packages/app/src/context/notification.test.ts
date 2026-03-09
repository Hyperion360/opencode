import { describe, expect, test } from "bun:test"
import { buildNotificationIndex } from "./notification-index"
import { hasNotificationKey, notificationKey, resolveSessionNotification } from "./notification-routes"
import type { SessionNotificationInput } from "./notification-routes"

type Notification = {
  type: "turn-complete" | "error" | "review-ready" | "run-failed" | "approval-needed"
  session: string
  directory: string
  viewed: boolean
  time: number
  key?: string
  hasError?: boolean
}

const turn = (session: string, directory: string, viewed = false): Notification => ({
  type: "turn-complete",
  session,
  directory,
  viewed,
  time: 1,
})

const error = (session: string, directory: string, viewed = false): Notification => ({
  type: "error",
  session,
  directory,
  viewed,
  time: 1,
  hasError: true,
})

const runFailed = (session: string, directory: string, viewed = false): Notification => ({
  type: "run-failed",
  session,
  directory,
  viewed,
  time: 1,
  hasError: true,
})

describe("buildNotificationIndex", () => {
  test("builds unseen counts and unseen error flags", () => {
    const list = [
      turn("s1", "d1", false),
      error("s1", "d1", false),
      turn("s1", "d1", true),
      turn("s2", "d1", false),
      runFailed("s2", "d1", false),
      error("s3", "d2", true),
    ]

    const index = buildNotificationIndex(list)

    expect(index.session.all.get("s1")?.length).toBe(3)
    expect(index.session.unseen.get("s1")?.length).toBe(2)
    expect(index.session.unseenCount.get("s1")).toBe(2)
    expect(index.session.unseenHasError.get("s1")).toBe(true)

    expect(index.session.unseenCount.get("s2")).toBe(2)
    expect(index.session.unseenHasError.get("s2") ?? false).toBe(true)
    expect(index.session.unseenCount.get("s3") ?? 0).toBe(0)
    expect(index.session.unseenHasError.get("s3") ?? false).toBe(false)

    expect(index.project.unseenCount.get("d1")).toBe(4)
    expect(index.project.unseenHasError.get("d1")).toBe(true)
    expect(index.project.unseenCount.get("d2") ?? 0).toBe(0)
    expect(index.project.unseenHasError.get("d2") ?? false).toBe(false)
  })

  test("updates selectors after viewed transitions", () => {
    const list = [turn("s1", "d1", false), error("s1", "d1", false), turn("s2", "d1", false)]
    const next = list.map((item) => (item.session === "s1" ? { ...item, viewed: true } : item))

    const before = buildNotificationIndex(list)
    const after = buildNotificationIndex(next)

    expect(before.session.unseenCount.get("s1")).toBe(2)
    expect(before.session.unseenHasError.get("s1")).toBe(true)
    expect(before.project.unseenCount.get("d1")).toBe(3)
    expect(before.project.unseenHasError.get("d1")).toBe(true)

    expect(after.session.unseenCount.get("s1") ?? 0).toBe(0)
    expect(after.session.unseenHasError.get("s1") ?? false).toBe(false)
    expect(after.project.unseenCount.get("d1")).toBe(1)
    expect(after.project.unseenHasError.get("d1") ?? false).toBe(false)
  })

  test("routes approval before failed and ready alerts", () => {
    const payloads: SessionNotificationInput["payloads"] = {
      reviewReady: {
        title: "Ready",
        summary: "Review is ready",
        body: "body",
        target: { kind: "notification", label: "Notification", description: "Route short review-ready, failure, and approval-needed alerts.", format: "text" },
        event: "review-ready",
        tone: "success",
      },
      runFailed: {
        title: "Failed",
        summary: "Run failed",
        body: "body",
        target: { kind: "notification", label: "Notification", description: "Route short review-ready, failure, and approval-needed alerts.", format: "text" },
        event: "run-failed",
        tone: "danger",
      },
      approvalNeeded: {
        title: "Approval",
        summary: "Approval required",
        body: "body",
        target: { kind: "notification", label: "Notification", description: "Route short review-ready, failure, and approval-needed alerts.", format: "text" },
        event: "approval-needed",
        tone: "warning",
      },
    }

    expect(resolveSessionNotification({ payloads, reviewReady: true, runFailed: true, approvalNeeded: true })).toEqual(
      expect.objectContaining({ type: "approval-needed", channel: "permissions", title: "Approval" }),
    )
    expect(resolveSessionNotification({ payloads, reviewReady: true, runFailed: true, approvalNeeded: false })).toEqual(
      expect.objectContaining({ type: "run-failed", channel: "errors", title: "Failed" }),
    )
    expect(resolveSessionNotification({ payloads, reviewReady: true, runFailed: false, approvalNeeded: false })).toEqual(
      expect.objectContaining({ type: "review-ready", channel: "agent", title: "Ready" }),
    )
    expect(resolveSessionNotification({ payloads, reviewReady: false, runFailed: false, approvalNeeded: false })).toBeUndefined()
  })

  test("dedupes session-state alerts by notification key", () => {
    const key = notificationKey({
      type: "approval-needed",
      directory: "/tmp/app",
      session: "s7",
      title: "Approval",
      summary: "Approval required",
    })

    expect(hasNotificationKey([{ type: "approval-needed", session: "s7", directory: "/tmp/app", viewed: false, time: 1, key }], key)).toBe(true)
    expect(
      hasNotificationKey(
        [{ type: "approval-needed", session: "s7", directory: "/tmp/app", viewed: false, time: 1, key }],
        notificationKey({ type: "approval-needed", directory: "/tmp/app", session: "s7", title: "Approval", summary: "Changed summary" }),
      ),
    ).toBe(false)
  })
})
