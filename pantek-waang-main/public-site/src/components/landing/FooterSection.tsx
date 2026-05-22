import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DiscordIcon } from "../DiscordIcon";

interface FooterLinkProps {
  label: string;
  onClick: () => void;
}

function FooterLink({ label, onClick }: FooterLinkProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-[10px] font-mono uppercase tracking-wider cursor-pointer transition-colors"
      style={{
        color: hover ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );
}

interface FooterAnchorProps {
  label: string;
  href: string;
}

function FooterAnchor({ label, href }: FooterAnchorProps) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-[10px] font-mono uppercase tracking-wider cursor-pointer transition-colors"
      style={{
        color: hover ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
    </a>
  );
}

export function FooterSection() {
  const navigate = useNavigate();

  return (
    <footer
      className="px-8 md:px-16 py-12"
      style={{ borderTop: "1px solid var(--border-foid)" }}
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        {/* Left */}
        <div>
          <span
            style={{
              fontFamily: "var(--font-mono-foid)",
              color: "var(--text-primary)",
            }}
            className="font-medium tracking-tight text-xl"
          >
            FlowOption
            <span style={{ color: "var(--accent-foid)" }}>ID</span>
          </span>
          <div
            className="mt-2 text-[10px] font-mono leading-relaxed max-w-[280px]"
            style={{ color: "var(--text-muted)" }}
          >
            Real-time options analytics for SPX & NDX. Data via Databento OPRA
            Pillar. Access via Discord OAuth2.
          </div>
        </div>

        {/* Center */}
        <div className="flex gap-6 flex-wrap">
          <FooterLink label="Dashboard" onClick={() => navigate("/dashboard")} />
          <FooterLink label="Register" onClick={() => navigate("/register")} />
          <FooterLink label="Login" onClick={() => navigate("/login")} />
          <FooterAnchor label="Discord" href="https://discord.gg/dy78P5vP62" />
        </div>

        {/* Right */}
        <div className="flex flex-col items-start md:items-end gap-2">
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="rounded-full px-5 py-2 text-xs font-mono font-medium text-white flex items-center gap-2 cursor-pointer transition-transform hover:scale-[1.03]"
            style={{
              background:
                "linear-gradient(135deg, #5865F2 0%, #4752C4 60%, #8B5CF6 100%)",
              boxShadow:
                "0 0 16px rgba(88,101,242,0.3), inset 0 1px 1px rgba(255,255,255,0.15)",
              outline: "2px solid rgba(255,255,255,0.12)",
              outlineOffset: "-2px",
            }}
          >
            <DiscordIcon className="w-3.5 h-3.5" />
            <span>Join Discord</span>
          </button>
          <div
            className="text-[9px] font-mono"
            style={{ color: "var(--text-muted)" }}
          >
            flowoptionid.vercel.app
          </div>
        </div>
      </div>
    </footer>
  );
}

export default FooterSection;
