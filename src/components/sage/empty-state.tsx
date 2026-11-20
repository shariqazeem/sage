import type { ReactNode } from "react";

/** NOTHING HERE YET: one true sentence, and the first action. Never a fake card. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="sg-empty">
      <h2 className="sg-empty-title">{title}</h2>
      {children ? <p className="sg-text">{children}</p> : null}
      {action ? <div className="sg-empty-actions">{action}</div> : null}
    </div>
  );
}
