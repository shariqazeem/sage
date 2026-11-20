"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { refreshFounderSession } from "@/lib/auth/use-founder-session";
import { Button, type ButtonVariant } from "./button";
import { SignInSheet } from "./sign-in-sheet";

/** A button that opens the sign-in sheet in place, then shows the page as the person signed in. */
export function SignInButton({ children, variant = "primary", why }: { children: ReactNode; variant?: ButtonVariant; why?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <SignInSheet
        open={open}
        why={why}
        onClose={() => setOpen(false)}
        onSignedIn={() => {
          setOpen(false);
          void refreshFounderSession().then(() => router.refresh());
        }}
      />
    </>
  );
}
