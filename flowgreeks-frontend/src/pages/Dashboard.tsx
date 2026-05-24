/**
 * Dashboard placeholder. Feature work composes the real grid here:
 *   - GEX skyline (3D)
 *   - HIRO ribbon (uPlot)
 *   - max-pain magnetism gauge
 *   - walls relief (3D)
 *   - flow tape
 *   - 0DTE charm landscape
 *   - regime card
 *   - basis card
 *
 * Each block is a feature in src/features/* which mounts here via the
 * grid-based layout primitive (added with the dashboard feature work).
 */
export default function DashboardPage() {
  return (
    <div className="p-6">
      <div className="text-sm" style={{ color: "var(--color-fg-muted)" }}>
        dashboard scaffold — feature panes attach here
      </div>
    </div>
  );
}
