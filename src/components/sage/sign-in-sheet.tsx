"use client";

import type { ReactNode } from "react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { Sheet } from "./sheet";

/**
 * SIGNING IN, as a sheet over whatever you were doing. The doors are the product's own
 * (`FounderSignIn`: an email or Google, MetaMask, and X once it is switched on); this only frames
 * them, so the paste box, the bar and Earn all ask the same way and you never leave the page.
 */
export function SignInSheet({ open, onClose, onSignedIn, why }: { open: boolean; onClose: () => void; onSignedIn: () => void; why?: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sign in" side="center">
      {why ? <p className="sg-small">{why}</p> : null}
      <div className="sg-signin">
        <FounderSignIn onSignedIn={onSignedIn} explainer={<>One free signature. No transaction, and nothing moves.</>} />
      </div>
    </Sheet>
  );
}
