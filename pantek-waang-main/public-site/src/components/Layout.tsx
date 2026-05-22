import { Link, useNavigate } from "react-router-dom";
import { LogOut, User as UserIcon, Sun, Moon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DiscordIcon } from "@/components/DiscordIcon";
import { useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/toast";
import { useTheme } from "@/hooks/useTheme";

interface LayoutProps {
  children: React.ReactNode;
  variant?: "marketing" | "app";
}

export function Layout({ children, variant = "app" }: LayoutProps) {
  const user = useAuth((s) => s.user);
  const apiKeyLabel = useAuth((s) => s.apiKeyLabel);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { theme, toggle } = useTheme();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (variant === "marketing") {
    return (
      <div
        className="min-h-screen flex flex-col overflow-x-clip"
        style={{ background: "var(--bg)", color: "var(--text-primary)" }}
      >
        <header className="relative z-20 px-6 sm:px-8 py-6 animate-fade-in">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-3">
              <span
                className="font-medium tracking-tight text-lg sm:text-xl"
                style={{
                  fontFamily: "var(--font-mono-foid)",
                  color: "var(--text-primary)",
                }}
              >
                FlowOption
                <span style={{ color: "var(--accent-foid)" }}>ID</span>
              </span>
              <span className="liquid-glass rounded-full px-2 py-0.5 hidden sm:inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
                <span
                  className="text-[10px] font-mono tracking-widest"
                  style={{ color: "var(--accent-foid)" }}
                >
                  LIVE
                </span>
              </span>
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={toggle}
                className="liquid-glass rounded-full w-9 h-9 flex items-center justify-center cursor-pointer"
                aria-label="Toggle theme"
              >
                {theme === "dark" ? (
                  <Sun
                    className="w-4 h-4"
                    style={{ color: "var(--text-secondary)" }}
                  />
                ) : (
                  <Moon
                    className="w-4 h-4"
                    style={{ color: "var(--text-secondary)" }}
                  />
                )}
              </button>

              <Link
                to="/"
                className="liquid-glass rounded-full px-4 py-2 text-xs sm:text-sm cursor-pointer hidden sm:inline-flex items-center"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono-foid)",
                }}
              >
                Home
              </Link>

              {user ? (
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="liquid-glass rounded-full px-4 py-2 text-xs sm:text-sm cursor-pointer inline-flex items-center"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Dashboard
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate("/register")}
                  className="rounded-full px-4 sm:px-5 py-2 text-xs sm:text-sm font-medium text-white cursor-pointer flex items-center gap-2 transition-transform hover:scale-[1.03]"
                  style={{
                    background:
                      "linear-gradient(135deg, #5865F2 0%, #4752C4 60%, #8B5CF6 100%)",
                    boxShadow:
                      "0 0 20px rgba(88, 101, 242, 0.35), inset 0 1px 1px rgba(255,255,255,0.15)",
                    outline: "2px solid rgba(255,255,255,0.12)",
                    outlineOffset: "-2px",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  <DiscordIcon className="w-3.5 h-3.5" />
                  <span>Join</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col">{children}</main>

        <footer
          className="px-6 sm:px-8 md:px-16 py-10"
          style={{ borderTop: "1px solid var(--border-foid)" }}
        >
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <span
                className="font-medium tracking-tight text-base"
                style={{
                  fontFamily: "var(--font-mono-foid)",
                  color: "var(--text-primary)",
                }}
              >
                FlowOption
                <span style={{ color: "var(--accent-foid)" }}>ID</span>
              </span>
              <div
                className="mt-1 text-[10px] font-mono"
                style={{ color: "var(--text-muted)" }}
              >
                0DTE flow analytics for SPX & NDX
              </div>
            </div>
            <div className="flex items-center gap-5 flex-wrap">
              <Link
                to="/"
                className="text-[10px] font-mono uppercase tracking-wider transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                Home
              </Link>
              <Link
                to="/login"
                className="text-[10px] font-mono uppercase tracking-wider transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="text-[10px] font-mono uppercase tracking-wider transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                Register
              </Link>
              <a
                href="https://discord.gg/dy78P5vP62"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono uppercase tracking-wider transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                Discord
              </a>
            </div>
          </div>
        </footer>

        <Toaster />
      </div>
    );
  }

  // app variant
  return (
    <div
      style={{
        background: "var(--bg)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-mono-foid)",
        minHeight: "100vh",
      }}
    >
      <motion.header
        initial={reduce ? false : { y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          background:
            "color-mix(in srgb, var(--bg) 78%, transparent)",
          borderBottom: "1px solid var(--border-foid)",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 sm:px-8 flex h-14 items-center justify-between gap-3">
          {/* Left: logo + LIVE pill */}
          <Link to="/" className="flex items-center gap-3">
            <span
              className="font-medium tracking-tight text-lg sm:text-xl"
              style={{
                fontFamily: "var(--font-mono-foid)",
                color: "var(--text-primary)",
              }}
            >
              FlowOption
              <span style={{ color: "var(--accent-foid)" }}>ID</span>
            </span>
            <span className="liquid-glass rounded-full px-2 py-0.5 hidden sm:inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
              <span
                className="text-[10px] font-mono tracking-widest"
                style={{ color: "var(--accent-foid)" }}
              >
                LIVE
              </span>
            </span>
          </Link>

          {/* Right: theme + user */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="liquid-glass rounded-full pl-1.5 pr-3 py-1 inline-flex items-center gap-2 cursor-pointer"
                    style={{ fontFamily: "var(--font-mono-foid)" }}
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--accent-foid) 0%, color-mix(in srgb, var(--accent-foid) 55%, transparent) 100%)",
                        boxShadow:
                          "inset 0 1px 1px rgba(255,255,255,0.25)",
                      }}
                    >
                      <UserIcon
                        className="w-3 h-3"
                        style={{ color: "var(--bg)" }}
                      />
                    </span>
                    <span
                      className="hidden sm:inline text-xs tracking-wider"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {user.discord_username}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[14rem]"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-foid)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  <DropdownMenuLabel
                    className="text-[10px] tracking-[0.2em] uppercase"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Account
                  </DropdownMenuLabel>
                  <div
                    className="px-2 py-1.5 text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <div style={{ color: "var(--text-primary)" }}>
                      {user.discord_username}
                    </div>
                    <div className="mt-0.5">Status: {user.status}</div>
                    {apiKeyLabel ? (
                      <div className="mt-0.5">Key: {apiKeyLabel}</div>
                    ) : null}
                  </div>
                  <DropdownMenuSeparator
                    style={{ background: "var(--border-foid)" }}
                  />
                  <DropdownMenuItem
                    onClick={() => navigate("/dashboard")}
                    style={{ color: "var(--text-primary)" }}
                  >
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleLogout}
                    style={{ color: "var(--accent-put)" }}
                  >
                    <LogOut className="mr-2 h-3.5 w-3.5" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link
                  to="/login"
                  className="liquid-glass rounded-full px-4 py-2 text-xs cursor-pointer hidden sm:inline-flex items-center"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono-foid)",
                  }}
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="rounded-full px-4 py-2 text-xs font-medium inline-flex items-center cursor-pointer transition-transform hover:scale-[1.02]"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--accent-foid) 0%, color-mix(in srgb, var(--accent-foid) 60%, transparent) 100%)",
                    color: "var(--bg)",
                    fontFamily: "var(--font-mono-foid)",
                    boxShadow:
                      "0 0 18px var(--glow), inset 0 1px 1px rgba(255,255,255,0.18)",
                  }}
                >
                  Get access
                </Link>
              </>
            )}
          </div>
        </div>
      </motion.header>

      <main className="flex-1">{children}</main>

      <motion.footer
        initial={reduce ? false : { opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5 }}
        className="py-8"
        style={{ borderTop: "1px solid var(--border-foid)" }}
      >
        <div
          className="max-w-7xl mx-auto px-6 sm:px-8 flex flex-col items-center justify-between gap-3 text-[10px] tracking-wider sm:flex-row"
          style={{ color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--text-secondary)" }}>
              FlowOption
              <span style={{ color: "var(--accent-foid)" }}>ID</span>
            </span>
            <span className="uppercase">
              0DTE flow analytics for SPX &amp; NDX
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href="https://discord.gg/dy78P5vP62"
              target="_blank"
              rel="noopener noreferrer"
              className="uppercase transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Discord
            </a>
            <Link
              to="/dashboard"
              className="uppercase transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Dashboard
            </Link>
          </div>
        </div>
      </motion.footer>

      <Toaster />
    </div>
  );
}
