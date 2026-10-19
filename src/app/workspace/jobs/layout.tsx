// The founder's jobs. Same premium-light scope the job console uses.
import "../../hire/hire.css";
import "../../app/app.css";
import "../../app/motion.css";
import "../../app/demo-moments.css";

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return <div className="hire sage-app">{children}</div>;
}
