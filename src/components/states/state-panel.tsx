import * as React from "react";
import { CircleAlert, CircleCheck, Inbox, type LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Reusable async UI states.
 *
 * Every data-driven surface in Sage resolves to exactly one of these four
 * states. `StatePanel` is the canonical switch; the individual exports exist
 * for cases that already know their state at the call site.
 *
 * Conventions:
 *  - `data-state` reflects the rendered status (drives tests + styling).
 *  - error => role="alert"; loading/success => role="status".
 */
export type StateStatus = "loading" | "empty" | "error" | "success";

export interface StateContentProps {
  title?: string;
  description?: string;
  /** Optional action node (button, link) rendered below the message. */
  action?: React.ReactNode;
  className?: string;
}

interface StateShellProps {
  state: StateStatus;
  role?: React.AriaRole;
  className?: string;
  children: React.ReactNode;
}

function StateShell({ state, role, className, children }: StateShellProps) {
  return (
    <div
      data-slot="state-panel"
      data-state={state}
      role={role}
      aria-busy={state === "loading" || undefined}
      className={cn(
        "border-border bg-card flex w-full flex-col items-center justify-center gap-3 rounded-sm border px-6 py-10 text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

function StateIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <span
      className={cn(
        "border-border flex size-9 items-center justify-center rounded-sm border",
        tone,
      )}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function StateText({
  title,
  description,
  titleClassName,
}: {
  title: string;
  description?: string;
  titleClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p
        className={cn("text-foreground text-sm font-semibold", titleClassName)}
      >
        {title}
      </p>
      {description ? (
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function LoadingState({
  title = "Loading",
  description,
  rows = 3,
  className,
}: StateContentProps & { rows?: number }) {
  return (
    <StateShell state="loading" role="status" className={className}>
      <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
        {title}
      </p>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-3 w-full" />
        ))}
      </div>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      <span className="sr-only">Loading</span>
    </StateShell>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
  className,
  icon = Inbox,
}: StateContentProps & { icon?: LucideIcon }) {
  return (
    <StateShell state="empty" className={className}>
      <StateIcon icon={icon} tone="text-muted-foreground" />
      <StateText title={title} description={description} />
      {action}
    </StateShell>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
  icon = CircleAlert,
}: StateContentProps & { icon?: LucideIcon }) {
  return (
    <StateShell state="error" role="alert" className={className}>
      <StateIcon icon={icon} tone="text-verdict-scam" />
      <StateText
        title={title}
        description={description}
        titleClassName="text-verdict-scam"
      />
      {action}
    </StateShell>
  );
}

export function SuccessState({
  title = "Done",
  description,
  action,
  className,
  icon = CircleCheck,
}: StateContentProps & { icon?: LucideIcon }) {
  return (
    <StateShell state="success" role="status" className={className}>
      <StateIcon icon={icon} tone="text-verdict-safe" />
      <StateText
        title={title}
        description={description}
        titleClassName="text-verdict-safe"
      />
      {action}
    </StateShell>
  );
}

export interface StatePanelProps extends StateContentProps {
  status: StateStatus;
  /** Skeleton row count, only used by the loading state. */
  rows?: number;
}

/** Canonical async-state switch. Renders exactly one state for `status`. */
export function StatePanel({ status, ...props }: StatePanelProps) {
  switch (status) {
    case "loading":
      return <LoadingState {...props} />;
    case "empty":
      return <EmptyState {...props} />;
    case "error":
      return <ErrorState {...props} />;
    case "success":
      return <SuccessState {...props} />;
    default:
      status satisfies never;
      return null;
  }
}
