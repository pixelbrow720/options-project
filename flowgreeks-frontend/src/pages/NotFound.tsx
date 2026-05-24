import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="glass glass-border max-w-md p-6" style={{ display: "grid", gap: 8 }}>
        <div className="text-lg font-semibold">404</div>
        <div className="text-sm" style={{ color: "var(--color-fg-secondary)" }}>
          That route doesn't exist.
        </div>
        <Link
          to="/"
          className="text-sm"
          style={{ color: "var(--color-accent-cyan)" }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
