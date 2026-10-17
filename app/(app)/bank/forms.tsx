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
  }}>Alles selecteren / deselecteren</button>;
}
function PendingFields({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset disabled={pending} className="bank-fieldset" aria-busy={pending}>{children}{pending && <p role="status" className="secondary">Opslaan…</p>}</fieldset>;
}
export function UploadForm({ accounts, defaultAccount }: { accounts: { id: number; name: string }[]; defaultAccount?: number }) {
  return <ActionForm action={uploadStatement} className="bank-upload">
    <div className="bank-upload-fields">
      <Field name="statement" label="ING-bankafschrift" hint="CAMT.053-XML, met of zonder details van verzamelbetalingen. Maximaal 5 MB."><input id="statement" name="statement" type="file" accept=".xml,application/xml,text/xml" required/></Field>
      <Field name="account_id" label="Grootboekrekening bank" hint="Het IBAN wordt onthouden voor volgende imports."><select id="account_id" name="account_id" defaultValue={defaultAccount ?? ""} required><option value="">Kies een bankrekening</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <button className="button primary">Importeren ter controle</button>
    </div>
  </ActionForm>;
}
type Account = { id: number; name: string; kind: string };
export function PostingForm({ entryId, amountCents, bankAccountId, description, accounts, projects, hasCandidates, presets, suggestions }: {
  entryId: number; amountCents: number; bankAccountId: number; description: string; accounts: Account[]; projects: { id: number; name: string }[]; hasCandidates: boolean; presets: Preset[]; suggestions: number[];
}) {
  const [allocations, setAllocations] = useState<DraftAllocation[]>([{ key: 0, accountId: "", amount: (Math.abs(amountCents) / 100).toFixed(2).replace('.',','), memo: "" }]);
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
    } catch (e) { setError(e instanceof Error ? e.message : "Het boekingssjabloon kan niet worden toegepast."); }
  }
  return <ActionForm action={reviewEntry.bind(null, entryId)}>
    <input type="hidden" name="action" value="post"/>
    {presets.length > 0 && <PresetPicker presets={presets} selected={selected} onSelect={setSelected} onApply={apply} suggestions={suggestions}/>}
    {error && <p role="alert" className="bank-message error">{error}</p>}
    {applied && <><input type="hidden" name="preset_id" value={applied.id}/><input type="hidden" name="preset_version" value={applied.version}/><p className="bank-message">Toegepast: {applied.name}. Controleer hieronder de rekeningen en bedragen.</p></>}
    <div className="form-grid">
      <Field label="Omschrijving" name="description" full><input id="description" name="description" defaultValue={description} maxLength={1000} required/></Field>
      <Field label="Project" name="project_id" full><select id="project_id" name="project_id" value={project} onChange={e => setProject(e.target.value)}><option value="">Geen project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </div>
    <p className="bank-help">De bankregel wordt automatisch toegevoegd. Verdeel hieronder het volledige bedrag van {formatMoney(Math.abs(amountCents))} . Negatieve bedragen keren de boekingsrichting om, bijvoorbeeld bij verlegde btw.</p>
    <AllocationEditor allocations={allocations} onChange={setAllocations} accounts={accounts} bankAccountId={bankAccountId} amountCents={amountCents}/>
    {applied && amountCents > 0 && <label className="bank-check"><input type="checkbox" name="acknowledge_refund" required/>Dit is een terugbetaling van een leverancier. Ik heb de tegenboekingen voor kosten en btw gecontroleerd.</label>}
    {hasCandidates && <label className="bank-check"><input type="checkbox" name="acknowledge_candidates" required/>Ik heb de mogelijke koppelingen gecontroleerd. Dit is een afzonderlijke betaling.</label>}
    <button className="button primary" disabled={!Number.isFinite(remaining) || remaining !== 0}>Boeking verwerken</button>
  </ActionForm>;
}
