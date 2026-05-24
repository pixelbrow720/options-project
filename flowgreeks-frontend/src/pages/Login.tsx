/**
 * Login placeholder. Real form (API key paste + admin JWT) lands in
 * feature work. The route exists so the router boots end-to-end and
 * the auth store hookup can be wired without manufacturing a stub.
 */
export default function LoginPage() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div
        className="glass glass-border max-w-sm p-6"
        style={{ display: "grid", gap: 12 }}
      >
        <div className="text-lg font-semibold">FlowGreeks</div>
        <div className="text-sm" style={{ color: "var(--color-fg-secondary)" }}>
          Authentication form lands in feature work. For local dev, set
          <code style={{ margin: "0 4px" }}>VITE_DEV_API_KEY</code>
          in <code>.env.local</code>.
        </div>
      </div>
    </div>
  );
}
