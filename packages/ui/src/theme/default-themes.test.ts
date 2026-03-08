import { describe, expect, test } from "bun:test"
import { DEFAULT_THEMES } from "./default-themes"

describe("DEFAULT_THEMES", () => {
  test("includes Hyperion360", () => {
    expect(DEFAULT_THEMES.hyperion360?.id).toBe("hyperion360")
  })
})