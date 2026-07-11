import "../hire/hire.css";
import "../app/app.css";
import "../app/motion.css";
// The Deputy receipt (rendered here for a worker's own submission) is styled in
// demo-moments.css — import it so the confidence bar, quotes, engine badge, and
// the new attack strip render on /c, not just inside the app shell.
import "../app/demo-moments.css";

/**
 * Shared shell for the public campaign page. It uses the app's own design
 * language (the unified `.sage-*` / `.sb-*` vocabulary lives in app.css), so a
 * stranger meets the exact same product as the app. `.hire` provides the paper
 * tokens; `.sage-app` scopes the app styles.
 */
export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="hire sage-app">{children}</div>;
}
