"use client";

import { useState } from 'react';
import { Field } from '@/components/ui';
import { ActionForm } from '@/app/(app)/bank/forms';
import { postManualPresetAction } from '@/app/(app)/settings/presets/actions';
import { calculatePreset, parseAmount } from '@/lib/presets/calculation';
import type { Preset } from '@/lib/presets/calculation';
import { AllocationEditor, PresetPicker, draftAllocations, draftTotal } from './preset-editor';
import type { DraftAllocation, PostingAccount } from './preset-editor';
export function ManualPresetForm({ transactionId, presets, accounts, projects, projectId }: {
  transactionId: number; presets: Preset[]; accounts: PostingAccount[]; projects: { id: number; name: string }[]; projectId: number | null;
}) {
  const [selected, setSelected] = useState(''), [bank, setBank] = useState(''), [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<'net' | 'total'>('total'), [direction, setDirection] = useState('payment');
  const [project, setProject] = useState(String(projectId ?? ''));
  const [draft, setDraft] = useState<{ preset: Preset; total: number } | null>(null);
  const [allocations, setAllocations] = useState<DraftAllocation[]>([]), [error, setError] = useState('');
  function apply() {
    try {
      if (!bank) throw new Error("Kies eerst de bankrekening.");
      const preset = presets.find(p => String(p.id) === selected)!;
      const result = calculatePreset(preset, parseAmount(amount), basis);
      setDraft({ preset, total: result.total }); setAllocations(draftAllocations(result.allocations)); setError('');
      if (preset.project_id) setProject(String(preset.project_id));
    } catch (e) { setDraft(null); setError(e instanceof Error ? e.message : "Het boekingssjabloon kan niet worden toegepast."); }
  }
  return <ActionForm action={postManualPresetAction.bind(null, transactionId)}>
    <div className="form-grid">
      <Field label="Bankrekening" name="preset-bank"><select id="preset-bank" name="bank_account_id" value={bank} onChange={e => { setBank(e.target.value); setDraft(null); }} required><option value="">Kies een grootboekrekening</option>{accounts.filter(a => a.kind === 'asset').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Betaling of terugbetaling" name="preset-direction"><select id="preset-direction" name="direction" value={direction} onChange={e => { setDirection(e.target.value); setDraft(null); }}><option value="payment">Leveranciersbetaling</option><option value="refund">Terugbetaling leverancier</option></select></Field>
      <Field label="Bedrag" name="preset-amount"><input id="preset-amount" name="amount" value={amount} onChange={e => { setAmount(e.target.value); setDraft(null); }} inputMode="decimal" required/></Field>
      <Field label="Ingevoerd bedrag is" name="preset-basis"><select id="preset-basis" name="basis" value={basis} onChange={e => { setBasis(e.target.value as 'total' | 'net'); setDraft(null); }}><option value="total">Totaal bankbedrag</option><option value="net">Factuurbedrag exclusief btw</option></select></Field>
    </div>
    <PresetPicker presets={presets} selected={selected} onSelect={id => { setSelected(id); setDraft(null); }} onApply={apply}/>
    {error && <p className="bank-message error" role="alert">{error}</p>}
    {draft && <>
      <input type="hidden" name="preset_id" value={draft.preset.id}/><input type="hidden" name="preset_version" value={draft.preset.version}/>
      <Field label="Project" name="preset-project"><select id="preset-project" name="project_id" value={project} onChange={e => setProject(e.target.value)}><option value="">Geen project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <p className="bank-help">Controleer {draft.preset.name}. Positieve bedragen boeken kosten debet bij betalingen; negatieve bedragen boeken deze credit. Terugbetalingen keren alle boekingsregels om.</p>
      <AllocationEditor allocations={allocations} onChange={setAllocations} accounts={accounts} bankAccountId={Number(bank)} amountCents={draft.total * (direction === 'refund' ? 1 : -1)}/>
      {direction === 'refund' && <label className="bank-check"><input type="checkbox" name="acknowledge_refund" required/>Ik heb de tegenboekingen voor kosten en btw bij deze terugbetaling gecontroleerd.</label>}
      <button className="button primary" disabled={draftTotal(allocations) !== draft.total}>Sjabloonboeking verwerken</button>
    </>}
  </ActionForm>;
}
