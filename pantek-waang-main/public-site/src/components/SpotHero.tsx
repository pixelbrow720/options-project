import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  decimalsFor,
  formatPoints,
  formatPrice,
} from "@/lib/format";
import { useValueFlash } from "@/lib/useValueFlash";
import type { SpotPayload, SpotSource } from "@/lib/api";

interface SpotHeroProps {
  symbol: string;
  spot: SpotPayload | null;
  zeroGamma: number | null;
  futuresContract: string | null;
  className?: string;
}

const SOURCE_LABEL: Record<SpotSource, string> = {
  futures_basis: "Futures basis",
  parity: "Parity",
  stale_cache: "Stale cache",
};

const SOURCE_HELP: Record<SpotSource, string> = {
  futures_basis:
    "Live cash spot is computed from the front-month futures price minus current basis.",
  parity:
    "Cash spot is being inferred from put-call parity because futures basis isn't fresh.",
  stale_cache:
    "Live feed is stale. Showing the last known cached spot value.",
};

const SOURCE_ACCENT: Record<SpotSource, string> = {
  futures_basis: "var(--accent-foid)",
  parity: "var(--accent-amber)",
  stale_cache: "var(--accent-put)",
};

function SpotHeroImpl({
  symbol,
  spot,
  zeroGamma,
  futuresContract,
  className,
}: SpotHeroProps) {
  const reduce = useReducedMotion();
  const dec = decimalsFor(symbol);
  const cash = spot?.price ?? null;
  const futures = spot?.futures_price ?? null;
  const basis = spot?.basis ?? null;
  const source = spot?.source ?? null;

  const distance = cash !== null && zeroGamma !== null ? cash - zeroGamma : null;
  const above = distance !== null && distance >= 0;

  const { flash, pulseKey } = useValueFlash(cash, 650);
  const flashBg =
    flash === "up"
      ? "rgba(72, 187, 120, 0.18)"
      : flash === "down"
        ? "rgba(246, 135, 179, 0.18)"
        : "rgba(99, 179, 237, 0.18)";

  return (
    <div
      className={cn(
        "liquid-glass-strong rounded-3xl p-6 sm:p-7",
        className,
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <span
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono-foid)" }}
            >
              {symbol}
            </span>
            <span
              className="text-[10px] font-mono uppercase tracking-[0.18em]"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono-foid)" }}
            >
              cash spot
            </span>
          </div>
          {source ? (
            <span
              title={SOURCE_HELP[source]}
              className="liquid-glass cursor-help rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em]"
              style={{
                color: SOURCE_ACCENT[source],
                fontFamily: "var(--font-mono-foid)",
              }}
            >
              {SOURCE_LABEL[source]}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div
            className="relative tabular-nums"
            aria-live="polite"
            aria-atomic="true"
          >
            {!reduce && flash ? (
              <motion.span
                key={pulseKey}
                aria-hidden
                initial={{ opacity: 0.65 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none absolute -inset-x-3 -inset-y-1 -z-10 rounded-2xl blur-md"
                style={{ backgroundColor: flashBg }}
              />
            ) : null}
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "clamp(3rem, 6vw, 5rem)",
                color: "var(--text-primary)",
                lineHeight: 1,
              }}
            >
              {cash !== null ? formatPrice(cash, dec) : "—"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {futures !== null ? (
              <span
                className="liquid-glass rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] tabular-nums"
                title={futuresContract ?? undefined}
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                {futuresContract ?? "Futures"}
                <span
                  className="ml-2"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatPrice(futures, 2)}
                </span>
              </span>
            ) : null}
            {basis !== null ? (
              <span
                className="liquid-glass rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] tabular-nums"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                Basis
                <span
                  className="ml-2"
                  style={{
                    color:
                      basis >= 0 ? "var(--accent-foid)" : "var(--accent-put)",
                  }}
                >
                  {formatPoints(basis, 2)}
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <div
          className="flex flex-wrap items-baseline gap-x-3 text-sm"
          style={{ fontFamily: "var(--font-mono-foid)" }}
        >
          <span
            className="cursor-help text-[10px] uppercase tracking-[0.2em] decoration-dotted underline-offset-4 hover:underline"
            style={{ color: "var(--text-secondary)" }}
            title="The strike where dealer net gamma flips sign. Above = positive gamma (price-pinning). Below = negative gamma (price-amplifying)."
          >
            Zero Gamma
          </span>
          <span
            className="font-mono text-base tabular-nums"
            style={{ color: "var(--text-primary)" }}
          >
            {zeroGamma !== null ? formatPrice(zeroGamma, dec) : "—"}
          </span>
          {distance !== null ? (
            <span
              className="font-mono text-sm tabular-nums"
              style={{
                color: above ? "var(--accent-foid)" : "var(--accent-put)",
              }}
            >
              ({formatPoints(distance, 2)} pts {above ? "above" : "below"})
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const SpotHero = memo(SpotHeroImpl);

export default SpotHero;
