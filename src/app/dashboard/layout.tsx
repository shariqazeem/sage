// The founder's home base. Same premium-light scope as /app, /c, and the console.
import "../hire/hire.css";
import "../app/app.css";
import "../app/motion.css";
import "../app/demo-moments.css";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="hire sage-app">{children}</div>;
}
