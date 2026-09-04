"use client";

import { useEffect, useState } from "react";
import { VerifyPerson } from "./verify-person";

/**
 * ASKED WHERE IT IS ANSWERED — at the mission, not on a page nobody visits.
 *
 * Standing is only required above a small ceiling, so most people never see this at all. The ones
 * who do are looking at a mission worth more than a couple of dollars, which is exactly the moment
 * the question "are you one person" is worth asking and worth answering: it is one minute, once,
 * and every future mission at every tier is open afterwards.
 *
 * It is an INVITATION, not the gate. The submit route is the gate — it derives the wallet from the
 * session and refuses with the reason. A prompt that could be bypassed by hiding the element would
 * be theatre; this one just makes the requirement visible before someone writes an account they
 * cannot submit.
 */
interface Status {
  available: boolean;
  verified: boolean;
  tier: "flagged" | "newcomer" | "established";
  reason: string;
  requiresStanding?: boolean;
  meets?: boolean;
}

export function MissionVerify({ wallet, rewardBase }: { wallet: string; rewardBase: number }) {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/identity?wallet=${encodeURIComponent(wallet)}&reward=${rewardBase}`, { cache: "no-store" })
      .then(async (r) => { if (r.ok && alive) setSt((await r.json()) as Status); })
      .catch(() => {});
    return () => { alive = false; };
  }, [wallet, rewardBase]);

  // Nothing to say when the door is shut, when this mission does not ask for standing, or when the
  // person already has it — silence is the correct render for the large majority.
  if (!st?.available || !st.requiresStanding || st.meets) return null;

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
