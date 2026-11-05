import { describe, expect, it } from "vitest";
import en from "./en";
import ru from "./ru";

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("translations", () => {
  it("has the same keys in English and Russian", () => {
    const english = new Set(flatten(en));
    const russian = new Set(flatten(ru));
    expect([...english].filter((key) => !russian.has(key))).toEqual([]);
    expect([...russian].filter((key) => !english.has(key))).toEqual([]);
  });
});
