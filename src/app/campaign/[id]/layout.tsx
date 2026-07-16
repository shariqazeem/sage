// The founder console reuses the app's LIGHT premium vocabulary (.sage-*/.cw-*/.v2-*),
// but — unlike /app and /c/[slug] — it had no layout, so it never imported hire.css and
// never entered the `.hire` token scope. Its light tokens were therefore undefined and the
// global dark body showed through ("dark by omission"). This mirrors src/app/app/layout.tsx
// and src/app/(campaigns)/layout.tsx so the console renders in the same premium-light theme.
import "../../hire/hire.css";
import "../../app/app.css";
import "../../app/motion.css";
import "../../app/demo-moments.css";

export default function CampaignConsoleLayout({ children }: { children: React.ReactNode }) {
  return <div className="hire sage-app">{children}</div>;
}
