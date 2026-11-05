import { describe, expect, it } from "vitest";
import { formatBytes, shortenPath } from "./format";

describe("formatBytes", () => {
  it("formats bytes and kilobytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("shortenPath", () => {
  it("keeps short paths intact", () => {
    expect(shortenPath("/tmp/project", 40)).toBe("/tmp/project");
  });

  it("shortens long paths", () => {
    const result = shortenPath(`/Users/example/Documents/${"a".repeat(80)}`, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.startsWith("…")).toBe(true);
  });
});
