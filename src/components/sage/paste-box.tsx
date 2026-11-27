"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { refreshFounderSession, useFounderSession } from "@/lib/auth/use-founder-session";
import { rememberInspection } from "@/lib/launch/recent-inspections";
import { DEFAULT_TEST, pastedLink } from "@/lib/site/paste-link";
import { testPath } from "@/lib/site/test-path";
import { storedVia } from "@/lib/site/via";
import { Button } from "./button";
import { SignInSheet } from "./sign-in-sheet";

/** The bar's "New test" asks the box on this page to take the cursor (see top-bar.tsx). */
export const NEW_TEST_EVENT = "sage:new-test";
export const PASTE_BOX_ID = "paste";

const newId = (): string => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * THE PASTE BOX: the whole way in. One link, one button.
 *
 * Signed out, the button opens the sign-in sheet and then carries on by itself, so the link is
 * typed once. Then it starts the same inspection the launch form starts (POST /api/launch: Sage
 * only reads the product, and nothing is paid) with the default test of 10 people at $2.00, and
 * goes to the test's page.
 */
export function PasteBox({ compact = false, note, autoFocus = false }: { compact?: boolean; note?: ReactNode; autoFocus?: boolean }) {
  const router = useRouter();
  const founder = useFounderSession();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [askSignIn, setAskSignIn] = useState(false);
  // One request id per LINK, not per mount: a double tap on the same link is one test, and a
  // corrected link is a new request (the server refuses an id reused with a different payload).
  const requestIds = useRef(new Map<string, string>());

  // "Test it again" on a finished test lands here with its product's address: the box is filled and ready
  useEffect(() => {
    const again = new URLSearchParams(window.location.search).get("test");
    if (again && /^https?:\/\//i.test(again) && again.length < 2048) {
      setValue(again);
      input.current?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const take = () => {
      input.current?.scrollIntoView({ block: "center", behavior: "auto" });
      input.current?.focus({ preventScroll: true });
    };
    const onHash = () => {
      if (window.location.hash === `#${PASTE_BOX_ID}`) take();
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    window.addEventListener(NEW_TEST_EVENT, take);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener(NEW_TEST_EVENT, take);
    };
  }, []);

  const start = async (link: string) => {
    setBusy(true);
    setProblem(null);
    let id = requestIds.current.get(link);
    if (!id) {
      id = newId();
      requestIds.current.set(link, id);
    }
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productUrl: link, repoUrl: "", goal: "", targetUsers: "", budgetUsd: String(DEFAULT_TEST.budgetUsd), requestId: id, testAccount: null, via: storedVia() }),
      });
      if (res.status === 401) {
        setBusy(false);
        setAskSignIn(true);
        return;
      }
      const data = (await res.json()) as { ok?: boolean; error?: string; job?: { id: string } };
      if (!data.ok || !data.job) {
        requestIds.current.delete(link);
        setProblem(data.error ?? "Sage couldn't start that test. Try again in a moment.");
        setBusy(false);
        router.refresh();
        return;
      }
      rememberInspection(data.job.id, link);
      router.push(testPath(data.job.id));
    } catch {
      setProblem("Sage couldn't be reached. Check your connection and try again.");
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const link = pastedLink(value);
    if (!link) {
      setProblem(value.trim() ? "That doesn't look like a link. Try something like yourproduct.com." : "Paste your product's link first.");
      input.current?.focus();
      return;
    }
    setProblem(null);
    if (!founder.authed) {
      setAskSignIn(true);
      return;
    }
    void start(link);
  };

  const signedIn = async () => {
    setAskSignIn(false);
    await refreshFounderSession();
    const link = pastedLink(value);
    if (link) void start(link);
    else router.refresh();
  };

  return (
    <>
    <form className="sg-paste-form" id={PASTE_BOX_ID} onSubmit={submit} noValidate>
      <div className="sg-paste" data-compact={compact || undefined}>
        <Link2 className="sg-paste-icon" size={18} strokeWidth={1.75} aria-hidden />
        <input
          ref={input}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="url"
          enterKeyHint="go"
          placeholder="yourproduct.com"
          aria-label="Your product's link"
          aria-invalid={problem ? true : undefined}
          aria-describedby="paste-note"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            setValue(e.target.value);
            if (problem) setProblem(null);
          }}
        />
        <Button type="submit" disabled={busy} size={compact ? "sm" : "md"}>
          {busy ? (
            <>
              <Loader2 size={16} className="sg-spin" aria-hidden /> Starting
            </>
          ) : (
            <>
              Start test <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </>
          )}
        </Button>
      </div>
      {problem ? (
        <p className="sg-paste-note" data-kind="problem" id="paste-note" role="alert">
          {problem}
        </p>
      ) : note ? (
        <p className="sg-paste-note" id="paste-note">
          {note}
        </p>
      ) : null}
    </form>
    <SignInSheet
      open={askSignIn}
      onClose={() => setAskSignIn(false)}
      onSignedIn={() => void signedIn()}
      why="Sign in so the test is yours to come back to. Then Sage starts trying your product."
    />
    </>
  );
}
