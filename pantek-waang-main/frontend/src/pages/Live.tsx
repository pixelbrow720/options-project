import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { ConnectionStatusIndicator } from "@/components/live/ConnectionStatus";
import { FlowFeed } from "@/components/live/FlowFeed";
import { GexChart } from "@/components/live/GexChart";
import { HiroPanel } from "@/components/live/HiroPanel";
import { RegimeBadge } from "@/components/live/RegimeBadge";
import { WallsCards } from "@/components/live/WallsCards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Status } from "@/lib/api";
import { LiveSnapshotProvider, useLiveSnapshot } from "@/lib/streamClient";
import { formatTimeET } from "@/lib/utils";

// Mirror backend `_SYMBOL_PATTERN` (^[A-Z][A-Z0-9]{0,11}$) so the user gets
// immediate feedback before we dispatch a doomed connection attempt.
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;

function LiveDashboardInner() {
  const { symbol, apiKey, setSymbol, setApiKey, snapshot, status, lastFrameAt } =
    useLiveSnapshot();
  const [supportedSymbols, setSupportedSymbols] = useState<string[]>([]);
  const [draftSymbol, setDraftSymbol] = useState<string>(symbol);
  const [draftKey, setDraftKey] = useState<string>(apiKey);
  const [symbolError, setSymbolError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Status.health()
      .then((h) => {
        if (!cancelled) setSupportedSymbols(h.supported_symbols ?? []);
      })
      .catch(() => {
        /* health is admin-only; ignore failures */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = snapshot?.data;
  const sess = data?.session_state;
  const spot = data?.spot;
  const zdte = data?.zero_dte;

  function onConnect() {
    const candidate = draftSymbol.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(candidate)) {
      setSymbolError("Invalid symbol. Must start with a letter, A-Z0-9 only, max 12 chars.");
      return;
    }
    setSymbolError(null);
    setSymbol(candidate);
    setApiKey(draftKey);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Live</h1>
            <RegimeBadge regime={data?.regime} />
            {sess?.is_expiration_day && (
              <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-500">
                0DTE day
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Streaming snapshot for <span className="font-mono">{symbol || "—"}</span>
            {snapshot?.computed_at && (
              <>
                {" "}
                · last frame {formatTimeET(snapshot.computed_at)}
              </>
            )}
          </p>
        </div>
        <ConnectionStatusIndicator status={status} lastFrameAt={lastFrameAt} />
      </div>

      {/* Rev 4 — RTH session banner + spot-source badge + flip speed */}
      <div className="grid gap-3 md:grid-cols-3">
        <div
          className={`rounded-md border p-3 ${
            sess?.is_rth
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-border bg-muted/40"
          }`}
        >
          <div className="text-xs uppercase text-muted-foreground">Session</div>
          <div className="text-sm font-semibold">
            {sess?.is_rth ? "RTH open" : sess ? "After hours" : "—"}
          </div>
          {sess?.minutes_to_close !== null && sess?.minutes_to_close !== undefined && sess.is_rth && (
            <div className="text-xs text-muted-foreground">
              {Math.max(0, Math.round(sess.minutes_to_close))} min to close
            </div>
          )}
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="text-xs uppercase text-muted-foreground">Spot</div>
          <div className="text-sm font-semibold">
            {spot ? spot.price.toFixed(2) : "—"}
          </div>
          {spot && (
            <div className="text-xs text-muted-foreground">
              source: <span className="font-mono">{spot.source ?? "—"}</span>
              {spot.basis !== null && spot.basis !== undefined && (
                <> · basis {spot.basis.toFixed(2)}</>
              )}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="text-xs uppercase text-muted-foreground">0DTE flip speed</div>
          <div className="text-sm font-semibold">
            {zdte?.flip_speed !== undefined ? zdte.flip_speed.toFixed(2) : "—"}
          </div>
          {zdte?.charm_decay_rate !== undefined && (
            <div className="text-xs text-muted-foreground">
              charm decay {zdte.charm_decay_rate.toFixed(4)} /hr
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-background/40 p-3">
        <div className="grid gap-3 md:grid-cols-3 md:items-end">
          <div>
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              list="symbol-list"
              className="mt-1 font-mono"
              value={draftSymbol}
              placeholder="SPXW"
              onChange={(e) => {
                setDraftSymbol(e.target.value.toUpperCase());
                if (symbolError) setSymbolError(null);
              }}
            />
            <datalist id="symbol-list">
              {supportedSymbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {symbolError && (
              <p className="mt-1 text-xs text-destructive">{symbolError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="api-key">API key</Label>
            <Input
              id="api-key"
              type="password"
              className="mt-1 font-mono"
              value={draftKey}
              placeholder="ofa_…"
              onChange={(e) => setDraftKey(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={onConnect} className="gap-2">
              <Activity className="h-4 w-4" />
              Connect
            </Button>
            {(symbol || apiKey) && (
              <Button
                variant="outline"
                onClick={() => {
                  setSymbol("");
                  setApiKey("");
                  setDraftSymbol("");
                  setDraftKey("");
                  setSymbolError(null);
                }}
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GexChart payload={data?.gex} title="GEX (OI)" description="Per-strike gamma exposure" />
        </div>
        <HiroPanel payload={data?.hiro} />
      </div>

      <WallsCards walls={data?.walls} maxPain={data?.max_pain} />

      <FlowFeed flow={data?.flow} />
    </div>
  );
}

export function LivePage() {
  return (
    <LiveSnapshotProvider initialSymbol="SPXW">
      <LiveDashboardInner />
    </LiveSnapshotProvider>
  );
}
