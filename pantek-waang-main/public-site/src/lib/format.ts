/**
 * Number / time formatting helpers tailored for trading dashboards.
 *
 * All numeric helpers respect locale defaults but force tabular numerics by
 * pairing them with `tabular-nums` typography in the UI layer.
 *
 * Uses Intl.NumberFormat with `signDisplay: "exceptZero"` for signed
 * numbers so we get proper minus signs (U+2212) and consistent locale
 * separators.
 */

const NULLISH = (v: number | null | undefined): boolean =>
  v === null || v === undefined || !Number.isFinite(v);

// ── Memoised Intl formatters ─────────────────────────────────────────────

const priceFormatters = new Map<number, Intl.NumberFormat>();
function priceFormatter(decimals: number): Intl.NumberFormat {
  let f = priceFormatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    priceFormatters.set(decimals, f);
  }
  return f;
}

const signedFormatters = new Map<number, Intl.NumberFormat>();
function signedFormatter(decimals: number): Intl.NumberFormat {
  let f = signedFormatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      signDisplay: "exceptZero",
    });
    signedFormatters.set(decimals, f);
  }
  return f;
}

// ── Public helpers ───────────────────────────────────────────────────────

export function formatPrice(value: number | null | undefined, decimals = 2): string {
  if (NULLISH(value)) return "—";
  return priceFormatter(decimals).format(value as number);
}

export function formatPoints(
  value: number | null | undefined,
  decimals = 2,
  signed = true,
): string {
  if (NULLISH(value)) return "—";
  if (!signed) return priceFormatter(decimals).format(value as number);
  return signedFormatter(decimals).format(value as number);
}

export function formatPct(
  value: number | null | undefined,
  decimals = 1,
  signed = true,
): string {
  if (NULLISH(value)) return "—";
  const v = value as number;
  if (!signed) return `${v.toFixed(decimals)}%`;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(decimals)}%`;
}

/**
 * Compact dollar formatting for big sums (GEX values).
 * 1.23B / -842M / 12.4K. Uses 2 sig digits of precision.
 */
export function formatDollarsCompact(
  value: number | null | undefined,
  signed = true,
): string {
  if (NULLISH(value)) return "—";
  const v = value as number;
  const abs = Math.abs(v);
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Format a per-second flow rate (USD/sec) into compact dollars per second.
 */
export function formatRate(value: number | null | undefined): string {
  if (NULLISH(value)) return "—";
  return `${formatDollarsCompact(value, true)}/s`;
}

/**
 * Currency formatting (alias for formatDollarsCompact when signed=false).
 * Compact dollar formatting without leading sign for positives.
 */
export function formatCurrency(
  value: number | null | undefined,
  signed = false,
): string {
  return formatDollarsCompact(value, signed);
}

/**
 * Format an integer count with locale grouping. Falls back to em-dash for nullish.
 */
export function formatNumber(
  value: number | null | undefined,
  decimals = 0,
): string {
  if (NULLISH(value)) return "—";
  return priceFormatter(decimals).format(value as number);
}

/**
 * Format an ISO timestamp (or any Date-parseable string) as "HH:MM" in the
 * viewer's locale. Used for intraday ticks and block-trade timestamps.
 */
export function formatTimeShort(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return value;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return value;
  }
}

/**
 * Hours-and-minutes "ago" string. Compact: 8h, 32m, 14s.
 */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  return formatDuration(Math.max(0, Date.now() - then));
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remM = minutes % 60;
    return remM === 0 ? `${hours}h` : `${hours}h ${remM}m`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH === 0 ? `${days}d` : `${days}d ${remH}h`;
}

/**
 * Humanize a positive countdown in seconds.
 */
export function formatCountdown(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Default decimals for an underlying ticker. SPX -> 2, NDX -> 2,
 * but treat them per the UI brief: SPX 4-decimal-feeling for spot is
 * actually SPX has 2, NDX has 2 but values are large; we'll surface 2.
 */
export function decimalsFor(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("NDX")) return 2;
  return 2;
}
