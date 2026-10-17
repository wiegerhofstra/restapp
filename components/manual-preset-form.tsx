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
      if (!bank) throw new Error('Choose the bank account first.');
      const preset = presets.find(p => String(p.id) === selected)!;
      const result = calculatePreset(preset, parseAmount(amount), basis);
      setDraft({ preset, total: result.total }); setAllocations(draftAllocations(result.allocations)); setError('');
      if (preset.project_id) setProject(String(preset.project_id));
    } catch (e) { setDraft(null); setError(e instanceof Error ? e.message : 'Unable to apply preset.'); }
  }
  return <ActionForm action={postManualPresetAction.bind(null, transactionId)}>
    <div className="form-grid">
      <Field label="Bank account" name="preset-bank"><select id="preset-bank" name="bank_account_id" value={bank} onChange={e => { setBank(e.target.value); setDraft(null); }} required><option value="">Choose account</option>{accounts.filter(a => a.kind === 'asset').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Payment or refund" name="preset-direction"><select id="preset-direction" name="direction" value={direction} onChange={e => { setDirection(e.target.value); setDraft(null); }}><option value="payment">Supplier payment</option><option value="refund">Supplier refund</option></select></Field>
      <Field label="Amount" name="preset-amount"><input id="preset-amount" name="amount" value={amount} onChange={e => { setAmount(e.target.value); setDraft(null); }} inputMode="decimal" required/></Field>
      <Field label="Amount entered is" name="preset-basis"><select id="preset-basis" name="basis" value={basis} onChange={e => { setBasis(e.target.value as 'total' | 'net'); setDraft(null); }}><option value="total">Total bank payment</option><option value="net">Net invoice amount</option></select></Field>
    </div>
    <PresetPicker presets={presets} selected={selected} onSelect={id => { setSelected(id); setDraft(null); }} onApply={apply}/>
    {error && <p className="bank-message error" role="alert">{error}</p>}
    {draft && <>
      <input type="hidden" name="preset_id" value={draft.preset.id}/><input type="hidden" name="preset_version" value={draft.preset.version}/>
      <Field label="Project" name="preset-project"><select id="preset-project" name="project_id" value={project} onChange={e => setProject(e.target.value)}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <p className="bank-help">Review {draft.preset.name}. Positive allocations debit expenses for payments; negative allocations credit them. Refunds reverse all entries.</p>
      <AllocationEditor allocations={allocations} onChange={setAllocations} accounts={accounts} bankAccountId={Number(bank)} amountCents={draft.total * (direction === 'refund' ? 1 : -1)}/>
      {direction === 'refund' && <label className="bank-check"><input type="checkbox" name="acknowledge_refund" required/>I reviewed the reversed expense and VAT entries for this refund.</label>}
      <button className="button primary" disabled={draftTotal(allocations) !== draft.total}>Post preset entries</button>
    </>}
  </ActionForm>;
}
