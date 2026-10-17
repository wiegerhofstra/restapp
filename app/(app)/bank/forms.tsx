"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { reviewEntry, uploadStatement } from "./actions";
import { AllocationEditor, PresetPicker, draftAllocations, draftTotal } from "@/components/preset-editor";
import type { DraftAllocation } from "@/components/preset-editor";
import { calculatePreset } from "@/lib/presets/calculation";
import type { Preset } from "@/lib/presets/calculation";
import type { ActionState } from "./actions";

export function ActionForm({ action, children, className }: { action: (state: ActionState, data: FormData) => Promise<ActionState>; children: React.ReactNode; className?: string }) {
  const [state, submit] = useActionState(action, {});
  return <form action={submit} className={className}>
    {state.error && <div role="alert" className="bank-message error">{state.error}</div>}
    {state.message && <div role="status" className="bank-message">{state.message}</div>}
    <PendingFields>{children}</PendingFields>
  </form>;
}
export function SelectSuggested() {
  return <button type="button" className="button small" onClick={event => {
    const boxes = event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="entry_id"]');
    if (!boxes?.length) return;
    const select = [...boxes].some(box => !box.checked);
    boxes.forEach(box => { box.checked = select; });
  }}>Select / clear all</button>;
}
function PendingFields({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset disabled={pending} className="bank-fieldset" aria-busy={pending}>{children}{pending && <p role="status" className="secondary">Saving…</p>}</fieldset>;
}
export function UploadForm({ accounts, defaultAccount }: { accounts: { id: number; name: string }[]; defaultAccount?: number }) {
  return <ActionForm action={uploadStatement} className="bank-upload">
    <div className="bank-upload-fields">
      <Field name="statement" label="ING statement" hint="CAMT.053 XML, with or without batch details. Up to 5 MB."><input id="statement" name="statement" type="file" accept=".xml,application/xml,text/xml" required/></Field>
      <Field name="account_id" label="Bank ledger account" hint="The IBAN will be remembered for future uploads."><select id="account_id" name="account_id" defaultValue={defaultAccount ?? ""} required><option value="">Choose bank account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <button className="button primary">Import for review</button>
    </div>
  </ActionForm>;
}
type Account = { id: number; name: string; kind: string };
export function PostingForm({ entryId, amountCents, bankAccountId, description, accounts, projects, hasCandidates, presets, suggestions }: {
  entryId: number; amountCents: number; bankAccountId: number; description: string; accounts: Account[]; projects: { id: number; name: string }[]; hasCandidates: boolean; presets: Preset[]; suggestions: number[];
}) {
  const [allocations, setAllocations] = useState<DraftAllocation[]>([{ key: 0, accountId: "", amount: (Math.abs(amountCents) / 100).toFixed(2), memo: "" }]);
  const [selected, setSelected] = useState(suggestions.length === 1 ? String(suggestions[0]) : "");
  const [applied, setApplied] = useState<Preset | null>(null);
  const [project, setProject] = useState("");
  const [error, setError] = useState("");
  const remaining = Math.abs(amountCents) - draftTotal(allocations);
  function apply() {
    try {
      const preset = presets.find(p => String(p.id) === selected)!;
      const result = calculatePreset(preset, Math.abs(amountCents));
      setAllocations(draftAllocations(result.allocations)); setApplied(preset); setError("");
      if (preset.project_id) setProject(String(preset.project_id));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to apply preset."); }
  }
  return <ActionForm action={reviewEntry.bind(null, entryId)}>
    <input type="hidden" name="action" value="post"/>
    {presets.length > 0 && <PresetPicker presets={presets} selected={selected} onSelect={setSelected} onApply={apply} suggestions={suggestions}/>}
    {error && <p role="alert" className="bank-message error">{error}</p>}
    {applied && <><input type="hidden" name="preset_id" value={applied.id}/><input type="hidden" name="preset_version" value={applied.version}/><p className="bank-message">Applied {applied.name}. Review the accounts and amounts below.</p></>}
    <div className="form-grid">
      <Field label="Description" name="description" full><input id="description" name="description" defaultValue={description} maxLength={1000} required/></Field>
      <Field label="Project" name="project_id" full><select id="project_id" name="project_id" value={project} onChange={e => setProject(e.target.value)}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </div>
    <p className="bank-help">The bank line is included automatically. Allocate the full {formatMoney(Math.abs(amountCents))} below. Negative allocations reverse that line’s direction, for example for reverse-charge VAT.</p>
    <AllocationEditor allocations={allocations} onChange={setAllocations} accounts={accounts} bankAccountId={bankAccountId} amountCents={amountCents}/>
    {applied && amountCents > 0 && <label className="bank-check"><input type="checkbox" name="acknowledge_refund" required/>This is a supplier refund. I reviewed the reversed expense and VAT entries.</label>}
    {hasCandidates && <label className="bank-check"><input type="checkbox" name="acknowledge_candidates" required/>I reviewed the possible matches and this is a separate payment.</label>}
    <button className="button primary" disabled={!Number.isFinite(remaining) || remaining !== 0}>Post transaction</button>
  </ActionForm>;
}
