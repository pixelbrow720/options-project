import { useTheme } from "../hooks/useTheme";
import { HeroSection } from "../components/landing/HeroSection";
import { TickerSection } from "../components/landing/TickerSection";
import { FeaturesSection } from "../components/landing/FeaturesSection";
import { AccessSection } from "../components/landing/AccessSection";
import { DataTeaserSection } from "../components/landing/DataTeaserSection";
import { FooterSection } from "../components/landing/FooterSection";

export default function Landing() {
  const { theme, toggle } = useTheme();

  return (
    <div className="overflow-x-clip" style={{ background: "var(--bg)" }}>
      <HeroSection theme={theme} onThemeToggle={toggle} />
      <TickerSection />
      <FeaturesSection />
      <AccessSection />
      <DataTeaserSection />
      <FooterSection />
    </div>
  );
}
