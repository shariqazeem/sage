"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The explorer's one input: paste a transaction hash → its /proof receipt; paste a wallet → its
 * /record. Pure client-side routing — the explorer needs no search API because every object
 * already has a canonical address.
 */
export function ExplorerSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [err, setErr] = useState(false);

  const go = () => {
    const v = q.trim().toLowerCase();
    if (/^0x[0-9a-f]{64}$/.test(v)) return router.push(`/proof/${v}`);
    if (/^0x[0-9a-f]{40}$/.test(v)) return router.push(`/record/${v}`);
    setErr(true);
  };

  return (
    <>
      <form
        className="exp-search"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <input
          className="exp-input"
          type="text"
          placeholder="0x… — a payout transaction or a wallet address"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setErr(false);
          }}
          aria-label="Search a transaction hash or wallet address"
        />
        <button type="submit" className="exp-go">
          Open
        </button>
      </form>
      <p className={`exp-hint${err ? " err" : ""}`}>
        {err
          ? "That's neither a transaction hash (66 chars) nor a wallet address (42 chars)."
          : "A transaction opens its proof receipt · a wallet opens its verified work record."}
      </p>
    </>
  );
}
