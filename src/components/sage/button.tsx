import Link from "next/link";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

/**
 * THE BUTTON. Three looks and two sizes, and the label is always a verb and its object ("Start test",
 * "See open tests"). Terracotta is the one primary action on a screen; everything else is quiet.
 */
export type ButtonVariant = "primary" | "quiet" | "plain";
export type ButtonSize = "md" | "sm";

interface Look {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** fills its container's width */
  wide?: boolean;
  className?: string;
}

const cls = (extra?: string) => (extra ? `sg-btn ${extra}` : "sg-btn");

export function Button({ variant = "primary", size = "md", wide, className, type = "button", children, ...rest }: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cls(className)} data-variant={variant} data-size={size} data-wide={wide || undefined} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  wide,
  className,
  children,
  ...rest
}: Look & { href: string; children: ReactNode; "aria-label"?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls(className)} data-variant={variant} data-size={size} data-wide={wide || undefined} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls(className)} data-variant={variant} data-size={size} data-wide={wide || undefined} {...rest}>
      {children}
    </Link>
  );
}
