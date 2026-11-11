import { describe, expect, it } from "vitest";
import { movieTitleSchema } from "@/lib/validation";

describe("movieTitleSchema", () => {
  it("trims and collapses whitespace", () => {
    expect(movieTitleSchema.parse("   The   Dark  Knight  ")).toBe("The Dark Knight");
  });

  it("accepts a one-character title", () => {
    expect(movieTitleSchema.parse("M")).toBe("M");
  });

  it("rejects empty or whitespace-only input", () => {
    expect(movieTitleSchema.safeParse("").success).toBe(false);
    expect(movieTitleSchema.safeParse("    ").success).toBe(false);
  });

  it("enforces the 100 character maximum after trimming", () => {
    expect(movieTitleSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(movieTitleSchema.safeParse(`  ${"a".repeat(100)}  `).success).toBe(true);
    expect(movieTitleSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(movieTitleSchema.safeParse("Alien\u0000").success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(movieTitleSchema.safeParse(42).success).toBe(false);
    expect(movieTitleSchema.safeParse(null).success).toBe(false);
  });
});
