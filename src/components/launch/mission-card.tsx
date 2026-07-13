"use client";

import { useState } from "react";
import { reward, type JobView, type MissionView } from "./types";

/**
 * One mission — progressive disclosure in view mode, a focused inline editor in edit
 * mode. Saving posts to /api/launch/<id>/revise: the server re-validates (safety +
 * scope), reallocates the budget exactly, recompiles the hashes, and returns a NEW
 * durable revision. Founder-language errors surface inline; an unsafe edit cannot save.
 * Locked (approved) missions are read-only.
 */
export function MissionCard({
  mission,
  jobId,
  revision,
  locked,
  onSaved,
}: {
  mission: MissionView;
  jobId: string;
  revision: number;
  locked: boolean;
  onSaved: (job: JobView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mission);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    setSaving(true); setErrors([]);
    try {
      const res = await fetch(`/api/launch/${jobId}/revise`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          edits: [{
            missionKey: mission.missionKey,
            title: draft.title, objective: draft.objective, instructions: draft.instructions,
            targetSurface: draft.targetSurface, criteria: draft.criteria.filter(Boolean),
            evidenceRequirements: draft.evidenceRequirements.filter(Boolean),
            maxCompletions: Number(draft.maxCompletions),
          }],
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        const issues: string[] = (data.issues ?? []).flatMap((r: { issues: { detail: string }[] }) => r.issues.map((i) => i.detail));
        setErrors(issues.length ? issues : [data.error ?? "This edit could not be saved."]);
        setSaving(false); return;
      }
      onSaved(data.job as JobView);
      setEditing(false);
    } catch {
      setErrors(["Could not save. Please try again."]);
    }
    setSaving(false);
  };

  const setList = (key: "criteria" | "evidenceRequirements", i: number, v: string) =>
    setDraft({ ...draft, [key]: draft[key].map((x, j) => (j === i ? v : x)) });
  const addLine = (key: "criteria" | "evidenceRequirements") => setDraft({ ...draft, [key]: [...draft[key], ""] });
  const rmLine = (key: "criteria" | "evidenceRequirements", i: number) => setDraft({ ...draft, [key]: draft[key].filter((_, j) => j !== i) });

  if (editing) {
    return (
      <article className="lx-mission lx-mission-editing">
        <EditField label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
        <EditField label="Objective" value={draft.objective} onChange={(v) => setDraft({ ...draft, objective: v })} />
        <EditField label="Tester steps" value={draft.instructions} onChange={(v) => setDraft({ ...draft, instructions: v })} textarea />
        <EditField label="Target surface" value={draft.targetSurface} onChange={(v) => setDraft({ ...draft, targetSurface: v })} mono />
        <EditList label="Counts as complete" items={draft.criteria} onEdit={(i, v) => setList("criteria", i, v)} onAdd={() => addLine("criteria")} onRemove={(i) => rmLine("criteria", i)} />
        <EditList label="Evidence required" items={draft.evidenceRequirements} onEdit={(i, v) => setList("evidenceRequirements", i, v)} onAdd={() => addLine("evidenceRequirements")} onRemove={(i) => rmLine("evidenceRequirements", i)} />
        <div className="lx-field" style={{ maxWidth: 200 }}>
          <label className="lx-label">Completions</label>
          <input className="lx-input" type="number" min={1} max={50} value={draft.maxCompletions}
            onChange={(e) => setDraft({ ...draft, maxCompletions: e.target.value })} />
        </div>
        {errors.length > 0 && <div className="lx-err" role="alert">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
        <div className="lx-next" style={{ marginTop: 8 }}>
          <button className="lx-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          <button className="lx-btn ghost" onClick={() => { setEditing(false); setDraft(mission); setErrors([]); }} disabled={saving}>Cancel</button>
        </div>
      </article>
    );
  }

  return (
    <article className="lx-mission">
      <div className="lx-mission-top">
        <h3 className="lx-mission-title">{mission.title}</h3>
        <div className="lx-reward">
          <div className="lx-reward-n">{reward(mission.rewardBase)}</div>
          <div className="lx-reward-s">× {mission.maxCompletions} · ~{mission.effortMinutes}m</div>
        </div>
      </div>
      <p className="lx-why"><b style={{ color: "var(--lx-ink)", fontWeight: 600 }}>Why Sage created this: </b>{mission.whyItMatters}</p>
      <div className="lx-tags">
        <span className="lx-tag">{mission.priority}</span>
        <span className="lx-tag">{mission.riskCategory.replace(/_/g, " ")}</span>
        <span className="lx-tag">max {reward(Number(mission.rewardBase) * Number(mission.maxCompletions))}</span>
      </div>
      <details className="lx-detail">
        <summary>See the exact task, evidence, and sources</summary>
        <div className="lx-sub-h">Target</div>
        <div className="lx-src">{mission.targetSurface}</div>
        <div className="lx-sub-h">Tester steps</div>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{mission.instructions}</p>
        <div className="lx-sub-h">Counts as complete</div>
        <ul className="lx-list">{mission.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <div className="lx-sub-h">Evidence required</div>
        <ul className="lx-list">{mission.evidenceRequirements.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <div className="lx-sub-h">How Sage will verify</div>
        <p style={{ fontSize: 13.5, color: "var(--lx-muted)", margin: 0, lineHeight: 1.5 }}>{mission.verificationMethod}</p>
        <div className="lx-sub-h">From what Sage observed</div>
        {mission.sources.map((s, i) => <div className="lx-src" key={i}>{s.kind}: {s.ref}</div>)}
      </details>
      {!locked && <button className="lx-edit-link" onClick={() => { setDraft(mission); setEditing(true); }}>Edit mission</button>}
    </article>
  );
}

function EditField({ label, value, onChange, textarea, mono }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean; mono?: boolean }) {
  return (
    <div className="lx-field">
      <label className="lx-label">{label}</label>
      {textarea
        ? <textarea className="lx-textarea" value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className="lx-input" value={value} onChange={(e) => onChange(e.target.value)} style={mono ? { fontFamily: "var(--font-mono, ui-monospace)", fontSize: 13 } : undefined} />}
    </div>
  );
}

function EditList({ label, items, onEdit, onAdd, onRemove }: { label: string; items: string[]; onEdit: (i: number, v: string) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  return (
    <div className="lx-field">
      <label className="lx-label">{label}</label>
      {items.map((it, i) => (
        <div key={i} className="lx-editline">
          <input className="lx-input" value={it} onChange={(e) => onEdit(i, e.target.value)} />
          <button type="button" className="lx-x" aria-label="Remove" onClick={() => onRemove(i)}>×</button>
        </div>
      ))}
      <button type="button" className="lx-edit-link" onClick={onAdd}>+ Add</button>
    </div>
  );
}
