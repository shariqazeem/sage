"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { Plus } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";
import { BAR_NAV, NEW_TEST_HREF, barPlace } from "@/components/shell/routes";
import { refreshFounderSession, useFounderSession } from "@/lib/auth/use-founder-session";
import { rememberVia } from "@/lib/site/via";
import { Button, ButtonLink } from "./button";
import { NEW_TEST_EVENT } from "./paste-box";

// Neither sheet is on the first screen: the wallet and the sign-in doors load when asked for.
const AccountSheet = dynamic(() => import("./account-sheet").then((m) => m.AccountSheet), { ssr: false });
const SignInSheet = dynamic(() => import("./sign-in-sheet").then((m) => m.SignInSheet), { ssr: false });

/**
 * THE ONE BAR. The mark, Tests, Earn, then New test and who is signed in. The same bar on a phone,
 * where "New test" becomes its icon; it never wraps.
 *
 * "Still asking" is not "signed out": until the session answers, the avatar's place is held and
 * nothing is claimed, so a signed-in person never sees "Sign in" flash past.
 */
export function TopBar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const founder = useFounderSession();
  const [sheet, setSheet] = useState<"account" | "signin" | null>(null);
  const place = barPlace(pathname);

  // where this person first came from (`?via=tiktok`), kept for the test they may start (src/lib/site/via.ts)
  useEffect(() => rememberVia(), []);

  const newTest = (e: MouseEvent<HTMLAnchorElement>) => {
    // Already on Home: the box is on this page, so take the cursor there instead of navigating.
    if (pathname !== "/") return;
    e.preventDefault();
    window.dispatchEvent(new Event(NEW_TEST_EVENT));
  };

  return (
    <header className="sg-bar">
      <div className="sg-bar-in">
        <Link href="/" className="sg-bar-brand" aria-label="Sage, home">
          <SageMark size={24} />
          <span className="sg-bar-word">Sage</span>
        </Link>
        <nav className="sg-bar-nav" aria-label="Sage">
          {BAR_NAV.map((l) => (
            <Link key={l.href} href={l.href} aria-current={place === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="sg-bar-right">
          <ButtonLink href={NEW_TEST_HREF} size="sm" className="sg-bar-new" onClick={newTest} aria-label="New test">
            <Plus className="sg-bar-new-icon" size={18} strokeWidth={2} aria-hidden />
            <span className="sg-bar-new-word">New test</span>
          </ButtonLink>
          {founder.loading ? (
            <span className="sg-avatar" data-waiting aria-hidden>
              0000
            </span>
          ) : founder.address ? (
            <button type="button" className="sg-avatar" onClick={() => setSheet("account")} aria-label="Your account" aria-haspopup="dialog" title={founder.address}>
              {founder.address.slice(-4)}
            </button>
          ) : (
            <Button variant="plain" size="sm" onClick={() => setSheet("signin")}>
              Sign in
            </Button>
          )}
        </div>
      </div>
      {sheet === "account" && founder.address ? <AccountSheet open address={founder.address} chain={founder.chain} onClose={() => setSheet(null)} /> : null}
      {sheet === "signin" ? (
        <SignInSheet
          open
          onClose={() => setSheet(null)}
          onSignedIn={() => {
            setSheet(null);
            void refreshFounderSession().then(() => router.refresh());
          }}
        />
      ) : null}
    </header>
  );
}
