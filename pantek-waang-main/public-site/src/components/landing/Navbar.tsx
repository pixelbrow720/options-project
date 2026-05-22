import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sun, Moon } from "lucide-react";
import { DiscordIcon } from "../DiscordIcon";
import type { Theme } from "../../hooks/useTheme";

interface NavbarProps {
  theme: Theme;
  onThemeToggle: () => void;
}

const NAV_LINKS = ["Pro", "Intraday", "Flow", "Chain", "Vol Surface"] as const;

export function Navbar({ theme, onThemeToggle }: NavbarProps) {
  const navigate = useNavigate();

  return (
    <nav className="relative z-20 px-8 py-6 animate-fade-in">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <span
            className="font-medium tracking-tight text-xl"
            style={{ fontFamily: "var(--font-mono-foid)", color: "var(--text-primary)" }}
          >
            FlowOption
            <span style={{ color: "var(--accent-foid)" }}>ID</span>
          </span>
          <span className="liquid-glass rounded-full px-2 py-0.5 inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
            <span
              className="text-[10px] font-mono tracking-widest"
              style={{ color: "var(--accent-foid)" }}
            >
              LIVE
            </span>
          </span>
        </div>

        {/* Center nav links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((label) => (
            <NavLink key={label} label={label} onClick={() => navigate("/dashboard")} />
          ))}
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onThemeToggle}
            className="liquid-glass rounded-full w-9 h-9 flex items-center justify-center cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            ) : (
              <Moon className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="liquid-glass rounded-full px-4 py-2 text-sm cursor-pointer hidden sm:inline-flex"
            style={{ color: "var(--text-primary)" }}
          >
            Login
          </button>

          <button
            type="button"
            onClick={() => navigate("/register")}
            className="rounded-full px-5 py-2 text-sm font-medium text-white cursor-pointer flex items-center gap-2 transition-transform hover:scale-[1.03]"
            style={{
              background: "linear-gradient(135deg, #5865F2 0%, #4752C4 60%, #8B5CF6 100%)",
              boxShadow:
                "0 0 20px rgba(88, 101, 242, 0.35), inset 0 1px 1px rgba(255,255,255,0.15)",
              outline: "2px solid rgba(255,255,255,0.12)",
              outlineOffset: "-2px",
            }}
          >
            <DiscordIcon className="w-4 h-4" />
            <span>Join via Discord</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

interface NavLinkProps {
  label: string;
  onClick: () => void;
}

function NavLink({ label, onClick }: NavLinkProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-sm tracking-wide uppercase transition-colors"
      style={{
        fontFamily: "var(--font-mono-foid)",
        color: hover ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );
}
