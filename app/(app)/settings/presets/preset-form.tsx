"use client";

import { useState } from 'react';
import { Field } from '@/components/ui';
import type { PostingAccount } from '@/components/preset-editor';
import type { Preset } from '@/lib/presets/calculation';
import { ActionForm } from '../../bank/forms';
import { savePresetAction } from './actions';
export function PresetForm({ preset, accounts, projects }: { preset?: Preset; accounts: PostingAccount[]; projects: { id: number; name: string }[] }) {
  const [mode, setMode] = useState(preset?.vat_mode ?? 'standard');
  const prefix = `preset-${preset?.id ?? 'new'}-`;
  function accountSelect(name: string, label: string, kind: string, value?: number | null) {
    return <Field name={prefix + name} label={label}><select id={prefix + name} name={name} defaultValue={value ?? ''} required><option value="">Choose account</option>{accounts.filter(a => a.kind === kind).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>;
  }
  return <ActionForm action={savePresetAction.bind(null, preset?.id ?? null)}>
    {preset && <input type="hidden" name="version" value={preset.version}/>}
    <div className="form-grid">
      <Field label="Name" name={prefix + 'name'}><input id={prefix + 'name'} name="name" defaultValue={preset?.name} maxLength={100} required/></Field>
      {accountSelect('expense_account_id', 'Expense account', 'expense', preset?.expense_account_id)}
      <Field label="VAT treatment" name={prefix + 'vat_mode'}><select id={prefix + 'vat_mode'} name="vat_mode" value={mode} onChange={e => setMode(e.target.value as Preset['vat_mode'])}><option value="standard">VAT on the supplier invoice</option><option value="reverse">Reverse-charge VAT</option><option value="none">No VAT</option></select></Field>
      {mode !== 'none' && <><Field label="VAT rate (%)" name={prefix + 'rate'}><input id={prefix + 'rate'} name="rate" inputMode="decimal" defaultValue={preset ? (preset.rate_bps / 100).toFixed(2) : '21'} required/></Field>{accountSelect('input_vat_account_id', 'Input VAT account', 'asset', preset?.input_vat_account_id)}</>}
      {mode === 'reverse' && accountSelect('output_vat_account_id', 'Output VAT account', 'liability', preset?.output_vat_account_id)}
      <Field label="Default project" name={prefix + 'project'}><select id={prefix + 'project'} name="project_id" defaultValue={preset?.project_id ?? ''}><option value="">No default</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </div>
    <label className="bank-check"><input type="checkbox" name="active" defaultChecked={preset?.active ?? true}/>Available for new postings</label>
    <button className="button primary">{preset ? 'Save preset' : 'Create preset'}</button>
  </ActionForm>;
}
