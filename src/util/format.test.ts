import { describe, expect, it } from "vitest";
import { humanAge, humanDims, humanSize } from "./format";

describe("humanSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2.0 KB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("humanAge", () => {
  const now = Date.parse("2026-06-01T12:00:00.000Z");
  it("renders relative ages", () => {
    expect(humanAge("2026-06-01T11:59:30.000Z", now)).toBe("just now");
    expect(humanAge("2026-06-01T11:30:00.000Z", now)).toBe("30m ago");
    expect(humanAge("2026-06-01T09:00:00.000Z", now)).toBe("3h ago");
    expect(humanAge("2026-05-30T12:00:00.000Z", now)).toBe("2d ago");
  });
  it("handles missing/invalid timestamps", () => {
    expect(humanAge(undefined, now)).toBe("—");
    expect(humanAge("not-a-date", now)).toBe("—");
  });
});

describe("humanDims", () => {
  it("formats and handles unknowns", () => {
    expect(humanDims(1920, 1080)).toBe("1920×1080");
    expect(humanDims(null, 5)).toBe("?×?");
  });
});
