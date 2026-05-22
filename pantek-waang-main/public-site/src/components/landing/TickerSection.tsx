import { Fragment } from "react";

type Tone = "bullish" | "bearish" | "neutral";

interface TickerItem {
  label: string;
  value: string;
  tone: Tone;
}

const items: readonly TickerItem[] = [
  { label: "SPX", value: "5,785.00", tone: "bullish" },
  { label: "NDX", value: "20,432.10", tone: "bearish" },
  { label: "GEX NET", value: "+$4.2B", tone: "bullish" },
  { label: "FLIP LEVEL", value: "5,720", tone: "neutral" },
  { label: "CALL WALL", value: "5,800", tone: "bullish" },
  { label: "PUT WALL", value: "5,650", tone: "bearish" },
  { label: "ATM IV", value: "14.8%", tone: "neutral" },
  { label: "0DTE GEX", value: "−$890M", tone: "bearish" },
  { label: "HIRO", value: "BULLISH", tone: "bullish" },
  { label: "CHARM NET", value: "−$2.1B", tone: "bearish" },
] as const;

function toneColor(tone: Tone): string {
  if (tone === "bullish") return "var(--accent-foid)";
  if (tone === "bearish") return "var(--accent-put)";
  return "var(--text-secondary)";
}

function TickerEntry({ label, value, tone }: TickerItem) {
  return (
    <span className="inline-flex items-center gap-2 mr-8 text-xs font-mono tracking-wider">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color: "var(--border-foid-strong)" }}>·</span>
      <span style={{ color: toneColor(tone) }}>{value}</span>
    </span>
  );
}

export function TickerSection() {
  // Render the items twice to give the translateX(-50%) keyframe a seamless loop.
  const renderRun = (runKey: string) =>
    items.map((item, idx) => (
      <Fragment key={`${runKey}-${item.label}-${idx}`}>
        <TickerEntry {...item} />
        {idx < items.length - 1 ? (
          <span style={{ color: "var(--border-foid-strong)", margin: "0 16px" }}>·</span>
        ) : null}
      </Fragment>
    ));

  return (
    <section
      className="border-y py-3 overflow-hidden"
      style={{ borderColor: "var(--border-foid)", background: "var(--bg)" }}
    >
      <div className="flex animate-ticker" style={{ whiteSpace: "nowrap" }}>
        {renderRun("a")}
        <span style={{ color: "var(--border-foid-strong)", margin: "0 16px" }}>·</span>
        {renderRun("b")}
      </div>
    </section>
  );
}

export default TickerSection;
