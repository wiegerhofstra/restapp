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
    return <Field name={prefix + name} label={label}><select id={prefix + name} name={name} defaultValue={value ?? ''} required><option value="">Kies een grootboekrekening</option>{accounts.filter(a => a.kind === kind).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>;
  }
  return <ActionForm action={savePresetAction.bind(null, preset?.id ?? null)}>
    {preset && <input type="hidden" name="version" value={preset.version}/>}
    <div className="form-grid">
      <Field label="Naam" name={prefix + 'name'}><input id={prefix + 'name'} name="name" defaultValue={preset?.name} maxLength={100} required/></Field>
      {accountSelect('expense_account_id', "Kostenrekening", 'expense', preset?.expense_account_id)}
      <Field label="Btw-behandeling" name={prefix + 'vat_mode'}><select id={prefix + 'vat_mode'} name="vat_mode" value={mode} onChange={e => setMode(e.target.value as Preset['vat_mode'])}><option value="standard">Btw op de inkoopfactuur</option><option value="reverse">Verlegde btw</option><option value="none">Geen btw</option></select></Field>
      {mode !== 'none' && <><Field label="Btw-tarief (%)" name={prefix + 'rate'}><input id={prefix + 'rate'} name="rate" inputMode="decimal" defaultValue={preset ? (preset.rate_bps / 100).toFixed(2).replace('.',',') : '21'} required/></Field>{accountSelect('input_vat_account_id', "Rekening voorbelasting", 'asset', preset?.input_vat_account_id)}</>}
      {mode === 'reverse' && accountSelect('output_vat_account_id', "Rekening verschuldigde btw", 'liability', preset?.output_vat_account_id)}
      <Field label="Standaardproject" name={prefix + 'project'}><select id={prefix + 'project'} name="project_id" defaultValue={preset?.project_id ?? ''}><option value="">Geen standaardproject</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </div>
    <label className="bank-check"><input type="checkbox" name="active" defaultChecked={preset?.active ?? true}/>Beschikbaar voor nieuwe boekingen</label>
    <button className="button primary">{preset ? "Sjabloon opslaan" : "Sjabloon aanmaken"}</button>
  </ActionForm>;
}
