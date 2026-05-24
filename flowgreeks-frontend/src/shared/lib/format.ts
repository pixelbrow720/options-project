/**
 * Number formatters tuned for trader displays.
 *
 * Rules:
 * - All numeric output must be tabular (caller must place these inside
 *   a `font-numeric` surface). Width-stable strings are why traders
 *   trust this UI.
 * - Sign is rendered as a leading + or − (true minus, not hyphen).
 * - "k" / "m" / "b" are case-sensitive and lowercase, no superscript.
 * - Currency uses USD by default; ticker overrides will land when we
 *   support non-US-listed indices.
 */

const TRUE_MINUS = "−";

export type SignedFormat = "leadingPlus" | "leadingMinusOnly" | "parens";

export interface FormatOptions {
  /** Number of significant decimals after the magnitude reduction. */
  decimals?: number;
  /** Leading sign behavior — defaults to leadingMinusOnly. */
  signed?: SignedFormat;
  /** Optional unit suffix (e.g. "%", "bps"). */
  unit?: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

function nf(decimals: number): Intl.NumberFormat {
  const key = String(decimals);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    formatters.set(key, f);
  }
  return f;
}

function applySign(magnitude: string, isNeg: boolean, mode: SignedFormat): string {
  switch (mode) {
    case "parens":
      return isNeg ? `(${magnitude})` : magnitude;
    case "leadingPlus":
      return isNeg ? `${TRUE_MINUS}${magnitude}` : `+${magnitude}`;
    case "leadingMinusOnly":
    default:
      return isNeg ? `${TRUE_MINUS}${magnitude}` : magnitude;
  }
}

/**
 * Compact magnitude formatter — 12,345,678 → "12.35m". Used for GEX,
 * HIRO, premium totals where ≥ 6 digits is unreadable.
 */
export function fmtCompact(n: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(n)) return "—";
  const { decimals = 2, signed = "leadingMinusOnly", unit = "" } = opts;
  const abs = Math.abs(n);
  let scaled = abs;
  let suffix = "";
  if (abs >= 1e12) {
    scaled = abs / 1e12;
    suffix = "t";
  } else if (abs >= 1e9) {
    scaled = abs / 1e9;
    suffix = "b";
  } else if (abs >= 1e6) {
    scaled = abs / 1e6;
    suffix = "m";
  } else if (abs >= 1e3) {
    scaled = abs / 1e3;
    suffix = "k";
  }
  const body = `${nf(decimals).format(scaled)}${suffix}${unit}`;
  return applySign(body, n < 0, signed);
}

/**
 * Plain decimal — for prices, strikes, IVs. Always grouped.
 */
export function fmtDecimal(n: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(n)) return "—";
  const { decimals = 2, signed = "leadingMinusOnly", unit = "" } = opts;
  const body = `${nf(decimals).format(Math.abs(n))}${unit}`;
  return applySign(body, n < 0, signed);
}

/** Percent (input is already a percent: 0.42 → "0.42%"). */
export function fmtPercent(n: number, opts: FormatOptions = {}): string {
  return fmtDecimal(n, { decimals: 2, unit: "%", ...opts });
}

/** Ratio in [0, 1] rendered as a percent: 0.42 → "42.00%". */
export function fmtRatio(n: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(n)) return "—";
  return fmtDecimal(n * 100, { decimals: 2, unit: "%", ...opts });
}

/** Basis points (input is a fraction: 0.0042 → "42.0 bps"). */
export function fmtBps(n: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(n)) return "—";
  return fmtDecimal(n * 1e4, { decimals: 1, unit: " bps", ...opts });
}

/** USD currency, compact. 12_345_678 → "$12.35m". */
export function fmtUsd(n: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(n)) return "—";
  const compact = fmtCompact(n, opts);
  if (compact.startsWith(TRUE_MINUS)) return `${TRUE_MINUS}$${compact.slice(1)}`;
  if (compact.startsWith("+")) return `+$${compact.slice(1)}`;
  if (compact.startsWith("(")) return `($${compact.slice(1)}`;
  return `$${compact}`;
}

/** Strike — integer if even, else 1 decimal. SPX strikes are already ints. */
export function fmtStrike(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return nf(0).format(n);
  return nf(1).format(n);
}

/** Wall-clock HH:MM:SS in the user's locale (used in flow tape). */
export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Compact age — "12s", "4m", "2h". For staleness pills and basis age. */
export function fmtAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}
