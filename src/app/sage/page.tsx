import { Search } from "lucide-react";

import { EmptyState } from "@/components/states/state-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VerdictBadge } from "@/components/verdict-badge";
import { VERDICTS } from "@/lib/verdicts";

const THESIS =
  "Sage is an autonomous agent that investigates crypto tokens launched within the last 72 hours and issues a verifiable verdict — SAFE, RISKY, or SCAM — backed by observable, on-chain evidence.";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-3">
            <span
              data-testid="wordmark"
              className="text-foreground font-mono text-lg font-bold tracking-[0.3em]"
            >
              SAGE
            </span>
            <span className="text-muted-foreground font-mono text-[0.65rem] tracking-[0.25em] uppercase">
              Autonomous Token Investigator
            </span>
          </div>
          <dl className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.65rem] tracking-widest uppercase">
            <StatusItem label="Scope" value="T-72H" />
            <StatusItem label="Network" value="Metis" />
            <StatusItem label="Status" value="Standby" />
          </dl>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-6 py-12">
        <section className="flex flex-col gap-4">
          <SectionLabel index="00" title="Thesis" />
          <p className="text-foreground max-w-3xl text-lg leading-relaxed text-balance sm:text-xl">
            {THESIS}
          </p>
          <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
            Scope is strict by design: Sage only investigates tokens whose first
            on-chain liquidity or mint event falls inside a rolling 72-hour
            window. Anything older is out of scope.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel index="01" title="Investigate" />
          <div className="border-border bg-card rounded-sm border">
            <div className="border-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
              <label htmlFor="token" className="sr-only">
                Token contract address
              </label>
              <Input
                id="token"
                name="token"
                placeholder="0x… token contract address"
                disabled
                className="font-mono"
              />
              <Button disabled className="sm:w-auto">
                <Search />
                Run investigation
              </Button>
            </div>
            <div className="p-4">
              <EmptyState
                title="No active investigation"
                description="Investigation execution is not wired up yet. This panel will stream the live, evidence-backed feed once an eligible address is submitted."
              />
            </div>
            <div className="border-border border-t px-4 py-2">
              <p className="text-muted-foreground font-mono text-[0.65rem] tracking-widest uppercase">
                Eligibility · launched ≤ 72h ago · evidence-backed feed only
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel index="02" title="Reputation Ledger" />
          <div className="border-border bg-card rounded-sm border">
            <div className="border-border flex flex-wrap items-center gap-2 border-b p-4">
              {VERDICTS.map((verdict) => (
                <VerdictBadge key={verdict} verdict={verdict} />
              ))}
              <span className="text-muted-foreground ml-auto font-mono text-[0.65rem] tracking-widest uppercase">
                Graded at T+30 days
              </span>
            </div>
            <div className="p-4">
              <EmptyState
                title="No graded verdicts yet"
                description="Every verdict is re-scored 30 days after issuance against what actually happened on-chain. Sage's track record will appear here once the first verdicts mature."
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-col gap-1 px-6 py-4 font-mono text-[0.65rem] tracking-widest uppercase sm:flex-row sm:items-center sm:justify-between">
          <p>Sage · Phase 0.1 foundation</p>
          <p>x402 · ERC-8004 · LazAI · Metis · GOAT</p>
        </div>
      </footer>
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground/60">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground font-mono text-xs">{index}</span>
      <span aria-hidden className="bg-border h-3 w-px" />
      <h2 className="text-foreground font-mono text-xs font-semibold tracking-[0.25em] uppercase">
        {title}
      </h2>
    </div>
  );
}
