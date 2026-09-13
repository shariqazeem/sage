"use client";

import { useState } from "react";
import { useAddFunds, usePrivy, useWallets } from "@privy-io/react-auth";
import { CreditCard, Loader2 } from "lucide-react";

/**
 * FUND WITH A CARD — the door for a founder who has no crypto at all.
 *
 * The honest routing, and the reason this component is not simply "buy USDC on this chain":
 * no fiat on-ramp settles onto GOAT or onto Arc. Circle's, MoonPay's and Coinbase's rails land
 * USDC on the large public chains. So a card buys USDC on Base into the founder's OWN embedded
 * wallet — the one Privy minted when they signed in with an email — and Circle's App Kit then
 * bridges it into the Sage account over CCTP. Two steps, both of them real, and the founder never
 * touches an exchange.
 *
 * A testnet account gets the faucet instead. Selling a card purchase that cannot settle would be
 * the same lie as a fake balance, so the button is simply not offered there.
 */
const BASE_CHAIN_CAIP = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function AddFunds({ testnet, bridgeable }: { testnet: boolean; bridgeable: boolean }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { addFunds } = useAddFunds();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The embedded wallet is the one Privy holds for an email sign-in. A founder who connected
  // their own browser wallet already has somewhere to buy into and does not need this door.
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  if (!ready || !authenticated || !embedded) return null;

  if (testnet) {
    return (
      <p className="ac-how" style={{ marginTop: 12 }}>
        <CreditCard size={13} style={{ verticalAlign: -2 }} /> Card top-ups arrive with mainnet. No
        fiat on-ramp settles onto a testnet, so this account funds from the faucet above.
      </p>
    );
  }

  const buy = async () => {
    setErr(null);
    setBusy(true);
    try {
      await addFunds({
        destination: { address: embedded.address, chain: BASE_CHAIN_CAIP, asset: BASE_USDC },
        fiat: { defaultAmount: "25" },
      });
      setDone(true);
    } catch (e) {
      // A closed modal is a choice, not a failure — say nothing for it.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/exit|cancel|close/i.test(msg)) setErr("That didn't go through. You can still send USDC to the address above.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ac-card-fund">
      <button type="button" className="sage-btn sage-btn-sm" onClick={() => void buy()} disabled={busy}>
        {busy ? <><Loader2 size={13} className="sage-spin2" /> Opening…</> : <><CreditCard size={13} /> Fund with a card</>}
      </button>
      <p className="ac-how" style={{ margin: "8px 0 0" }}>
        {done
          ? <>Bought. It lands in your own wallet on Base first{bridgeable ? <> — bridge it in below and it arrives here.</> : <>; send it to the address above and it arrives here.</>}</>
          : <>Buys USDC on Base into your own wallet{bridgeable ? <>, then the bridge below moves it here. No exchange account needed.</> : <>. Send it to the address above to fund this account. No exchange account needed.</>}</>}
      </p>
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
