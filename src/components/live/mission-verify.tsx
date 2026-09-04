"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { VerifyPerson } from "./verify-person";

/**
 * THE DOOR, ASKED WHERE IT IS ANSWERED — at the mission, before a word of the account is written.
 *
 * On public work every claimant proves they are one person, once: a minute, no name, no document,
 * no country. It is the founder's own design ("we will ask one time verification when they come to
 * attempt a mission") and the only rule that makes fifty slots need fifty humans — the reward-size
 * rule it replaces let every cheap slot through, which is exactly the shape the farm used.
 *
 * It is an INVITATION, not the gate. The submit route is the gate — it derives the wallet from the
 * session and answers `needsVerification` with the reason. This makes the requirement visible
 * before someone writes an account they cannot submit, and after success it says so and gets out
 * of the way. Members-only work never asks (the route says `requiresPersonhood: false`).
 */
interface Status {
  available: boolean;
  verified: boolean;
  doorArmed?: boolean;
  requiresPersonhood?: boolean;
  tier: "flagged" | "newcomer" | "established";
  reason: string;
  // the older reward-tier reading, still answered while the door is unarmed
  requiresStanding?: boolean;
  meets?: boolean;
}

export function MissionVerify({
  wallet,
  campaignId,
  rewardBase,
  /** set by the board when the submit route just answered `needsVerification` — opens the door. */
  demanded = false,
  onVerified,
}: {
  wallet: string;
  campaignId: string;
  rewardBase: number;
  demanded?: boolean;
  onVerified?: () => void;
}) {
  const [st, setSt] = useState<Status | null>(null);
  const load = useCallback(() => {
    return fetch(
      `/api/identity?wallet=${encodeURIComponent(wallet)}&campaign=${encodeURIComponent(campaignId)}&reward=${rewardBase}`,
      { cache: "no-store" },
    )
      .then(async (r) => { if (r.ok) setSt((await r.json()) as Status); })
      .catch(() => {});
  }, [wallet, campaignId, rewardBase]);

  useEffect(() => { void load(); }, [load, demanded]);

  if (!st?.available) return null;

  // The door: public work, unverified. One card, one button.
  if (st.requiresPersonhood || (demanded && !st.verified)) {
    return (
      <div className="mv mv-door">
        <p className="mv-t">One person, one slot — prove you are one person, once</p>
        <p className="mv-s">No name, no document, no country. About a minute, and every public mission is open to you from then on.</p>
        <VerifyPerson wallet={wallet} onVerified={() => { void load().then(() => onVerified?.()); }} />
      </div>
    );
  }

  // Verified on public work: say so once, quietly, and get out of the way.
  if (st.doorArmed && st.verified) {
    return (
      <p className="mv-ok">
        <ShieldCheck size={13} strokeWidth={2} /> Verified — one slot on this work is yours.
      </p>
    );
  }

  // The older reward-tier reading, while the door is unarmed.
  if (!st.requiresStanding || st.meets) return null;
  return (
    <div className="mv">
      <p className="mv-t">This one asks that you are one person</p>
      <p className="mv-s">
        {st.tier === "flagged"
          ? `This wallet shares standing with others: ${st.reason}. Work at the open tier is still yours to take.`
          : "Better-paid work needs it once — a minute, no name and no document, and every tier is open to you from then on."}
      </p>
      {st.tier !== "flagged" && <VerifyPerson wallet={wallet} />}
    </div>
  );
}
