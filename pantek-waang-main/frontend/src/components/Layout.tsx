import {
  IconActivity,
  IconChevronLeft,
  IconChevronRight,
  IconCircleDot,
  IconCommand,
  IconDatabase,
  IconGauge,
  IconKey,
  IconLogout,
  IconRadio,
  IconServer,
  IconServerCog,
  IconTargetArrow,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useLiveSnapshot } from "@/lib/streamClient";
import { cn } from "@/lib/utils";
import { ConnectionPill } from "./ConnectionPill";

interface NavItem {
  to: string;
  label: string;
  icon: typeof IconGauge;
  end?: boolean;
  group?: "main" | "admin";
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: IconGauge, end: true, group: "main" },
  { to: "/live", label: "Live", icon: IconRadio, group: "main" },
  { to: "/0dte", label: "0DTE", icon: IconTargetArrow, group: "main" },
  { to: "/data-inspector", label: "Data Inspector", icon: IconDatabase, group: "admin" },
  { to: "/api-keys", label: "API Keys", icon: IconKey, group: "admin" },
  { to: "/databento-keys", label: "Databento", icon: IconServer, group: "admin" },
  { to: "/system-status", label: "System", icon: IconServerCog, group: "admin" },
];

const SIDEBAR_STORAGE = "ofa_sidebar_collapsed";

function readSidebarPref(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_STORAGE) === "1";
}

function writeSidebarPref(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIDEBAR_STORAGE, collapsed ? "1" : "0");
}

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(readSidebarPref);

  useEffect(() => {
    writeSidebarPref(collapsed);
  }, [collapsed]);

  // Cmd+K placeholder — opens a stub overlay for now
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mainNav = NAV.filter((n) => n.group === "main");
  const adminNav = NAV.filter((n) => n.group === "admin");
  const sidebarWidth = collapsed ? 68 : 232;

  return (
    <div className="relative min-h-screen bg-bg-base text-fg-primary">
      {/* Sidebar ─────────────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="fixed left-0 top-0 z-30 hidden h-screen flex-col border-r border-border-subtle bg-bg-elevated/80 backdrop-blur-xl md:flex"
      >
        {/* Brand */}
        <div className="flex h-14 items-center gap-3 border-b border-border-subtle px-4">
          <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-gradient shadow-glow-accent">
            <IconActivity size={16} stroke={2.4} className="text-white" />
          </div>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="brand"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col leading-none"
              >
                <span className="text-sm font-semibold tracking-tight">FlowJob</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-fg-muted">
                  Options Analytics
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavGroup label="Workspace" collapsed={collapsed}>
            {mainNav.map((item) => (
              <NavRow key={item.to} item={item} collapsed={collapsed} />
            ))}
          </NavGroup>
          <NavGroup label="Admin" collapsed={collapsed} className="mt-6">
            {adminNav.map((item) => (
              <NavRow key={item.to} item={item} collapsed={collapsed} />
            ))}
          </NavGroup>
        </nav>

        {/* Sidebar footer: collapse + sign out */}
        <div className="border-t border-border-subtle px-3 py-3">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-fg-muted transition-colors duration-fast hover:bg-bg-card-hover hover:text-fg-primary",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <IconChevronRight size={14} stroke={2} />
            ) : (
              <>
                <IconChevronLeft size={14} stroke={2} />
                <span>Collapse</span>
              </>
            )}
          </button>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-fast hover:bg-negative-soft hover:text-negative",
              collapsed && "justify-center px-0",
            )}
          >
            <IconLogout size={16} stroke={2} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main column ────────────────────────────────────────────────── */}
      <div
        style={{ marginLeft: 0 }}
        className={cn(
          "relative z-10 flex min-h-screen flex-col transition-[margin] duration-base ease-out",
          collapsed ? "md:ml-[68px]" : "md:ml-[232px]",
        )}
      >
        <Topbar
          onCommand={() => setPaletteOpen(true)}
          path={location.pathname}
        />
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>

      {/* Command palette stub ─────────────────────────────────────────── */}
      <AnimatePresence>
        {paletteOpen && (
          <CommandPaletteStub onClose={() => setPaletteOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavGroup({
  label,
  children,
  collapsed,
  className,
}: {
  label: string;
  children: ReactNode;
  collapsed: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      {!collapsed && (
        <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-faint">
          {label}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast",
          isActive
            ? "bg-bg-card text-fg-primary"
            : "text-fg-muted hover:bg-bg-card/60 hover:text-fg-primary",
          collapsed && "justify-center px-0",
        )
      }
      title={collapsed ? item.label : undefined}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active-bar"
              className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent shadow-glow-accent"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <Icon size={16} stroke={2} />
          {!collapsed && <span>{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

// ── Topbar ─────────────────────────────────────────────────────────────────

function Topbar({ onCommand, path }: { onCommand: () => void; path: string }) {
  const { symbol, setSymbol, status, lastFrameAt } = useLiveSnapshot();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border-subtle bg-bg-base/70 px-6 backdrop-blur-xl">
      <Breadcrumb path={path} />
      <div className="flex-1" />
      <SymbolSelector value={symbol} onChange={setSymbol} />
      <ConnectionPill status={status} lastFrameAt={lastFrameAt} />
      <button
        onClick={onCommand}
        className="flex h-8 items-center gap-2 rounded-md border border-border-subtle bg-bg-card px-3 text-xs font-medium text-fg-muted transition-colors duration-fast hover:border-border-hover hover:text-fg-primary"
      >
        <IconCommand size={13} stroke={2} />
        <span>Search</span>
        <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-border-strong bg-bg-base px-1.5 py-0.5 font-mono text-[10px] text-fg-muted sm:flex">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}

function Breadcrumb({ path }: { path: string }) {
  const item = NAV.find((n) =>
    n.end ? path === n.to : path === n.to || path.startsWith(`${n.to}/`),
  );
  return (
    <div className="flex items-center gap-2 text-sm">
      <IconCircleDot size={12} className="text-accent" />
      <span className="font-medium text-fg-primary">
        {item?.label ?? "Workspace"}
      </span>
    </div>
  );
}

function SymbolSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Static for now; ⌘K palette will replace this with a richer search.
  const symbols = ["SPXW", "NDXP"];
  return (
    <div className="flex items-center gap-1 rounded-md border border-border-subtle bg-bg-card p-0.5">
      {symbols.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded px-2.5 py-1 font-mono text-xs font-semibold transition-colors duration-fast",
            value === s
              ? "bg-bg-card-hover text-fg-primary shadow-card"
              : "text-fg-muted hover:text-fg-primary",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ── Command palette stub (full implementation later) ───────────────────────

function CommandPaletteStub({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-start bg-black/60 backdrop-blur-sm pt-[18vh]"
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-border-strong bg-bg-popover p-2 shadow-popover"
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-3 pb-2">
          <IconCommand size={14} className="text-fg-muted" />
          <input
            autoFocus
            placeholder="Search symbols, metrics, settings…"
            className="flex-1 bg-transparent py-1.5 text-sm placeholder:text-fg-faint focus:outline-none"
          />
          <kbd className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
            ESC
          </kbd>
        </div>
        <div className="px-3 py-6 text-center text-xs text-fg-muted">
          Command palette is coming soon. Use the sidebar for now.
        </div>
      </motion.div>
    </motion.div>
  );
}
