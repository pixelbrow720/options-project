import { fmtCompact, fmtDecimal, fmtUsd, fmtAge, fmtRatio, fmtBps } from "./format";
import { describe, expect, it } from "vitest";

describe("format", () => {
  it("compact reduces magnitude with lowercase suffixes", () => {
    expect(fmtCompact(12_345_678)).toBe("12.35m");
    expect(fmtCompact(2_500)).toBe("2.50k");
    expect(fmtCompact(0.42)).toBe("0.42");
  });

  it("compact uses true minus glyph", () => {
    expect(fmtCompact(-1_500)).toBe("−1.50k");
  });

  it("usd prefixes dollar sign before sign-aware magnitude", () => {
    expect(fmtUsd(1_234_567)).toBe("$1.23m");
    expect(fmtUsd(-1_234_567)).toBe("−$1.23m");
  });

  it("decimal renders non-finite as em-dash placeholder", () => {
    expect(fmtDecimal(Number.NaN)).toBe("—");
    expect(fmtDecimal(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("ratio scales [0,1] to percent", () => {
    expect(fmtRatio(0.4234)).toBe("42.34%");
  });

  it("bps scales fraction to bps", () => {
    expect(fmtBps(0.0042)).toBe("42.0 bps");
  });

  it("age picks the largest unit", () => {
    expect(fmtAge(45)).toBe("45s");
    expect(fmtAge(125)).toBe("2m");
    expect(fmtAge(7200)).toBe("2h");
    expect(fmtAge(null)).toBe("—");
  });
});
