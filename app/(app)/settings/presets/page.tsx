import Link from 'next/link';
import { PageHeader, Field } from '@/components/ui';
import { rows } from '@/lib/db';
import { getPresets, getPresetRules, presetsReady } from '@/lib/presets/service';
import type { PostingAccount } from '@/components/preset-editor';
import { ActionForm } from '../../bank/forms';
import { PresetForm } from './preset-form';
import { addRuleAction, removeRuleAction } from './actions';

export default async function PresetsPage() {
  if (!await presetsReady()) return <><PageHeader title="Posting presets"/><p>Posting presets have not been set up yet.</p></>;
  const presets = await getPresets(true), rules = await getPresetRules();
  const accounts = await rows<PostingAccount>('SELECT id,name,kind FROM accounts WHERE can_post=1 ORDER BY name');
  const projects = await rows<{ id: number; name: string }>("SELECT p.id,c.name || ' · ' || p.name name FROM projects p JOIN customers c ON c.id=p.customer_id ORDER BY c.name,p.name");
  return <><PageHeader eyebrow="Settings" title="Posting presets" subtitle="Reusable accounts and VAT calculations for supplier payments. Every posting is reviewed first."><Link className="button" href="/bank">Bank imports</Link></PageHeader>
    <div className="grid">{presets.map(p => <section className="card" key={`${p.id}-${p.version}`}><div className="card-header"><h2 className="card-title">{p.name}</h2><span className={`badge ${p.active ? 'active' : 'draft'}`}>{p.active ? 'Active' : 'Inactive'}</span></div><div className="card-body">
      <PresetForm preset={p} accounts={accounts} projects={projects}/><hr className="divider"/>
      <h3>Supplier recognition</h3><p className="bank-help">Rules suggest this preset during import review. IBAN matches are exact; name and description rules contain the text you enter. Conflicting rules offer choices. Batches stay manual.</p>
      {rules.filter(r => r.preset_id === p.id).map(r => <div className="bank-toolbar" key={r.id}><span>{r.field === 'iban' ? 'IBAN equals' : `${r.field} contains`} <strong>{r.pattern}</strong> · {r.direction}</span><ActionForm action={removeRuleAction.bind(null, r.id)}><button className="button small">Remove rule</button></ActionForm></div>)}
      <ActionForm action={addRuleAction.bind(null, p.id)} className="preset-rule-form">
        <Field label="Match field" name={`rule-field-${p.id}`}><select id={`rule-field-${p.id}`} name="field"><option value="name">Counterparty name</option><option value="iban">Counterparty IBAN</option><option value="description">Payment description</option></select></Field>
        <Field label="Match text" name={`rule-pattern-${p.id}`}><input id={`rule-pattern-${p.id}`} name="pattern" minLength={3} maxLength={200} required/></Field>
        <Field label="Direction" name={`rule-direction-${p.id}`}><select id={`rule-direction-${p.id}`} name="direction"><option value="payment">Payments</option><option value="refund">Refunds</option><option value="both">Payments and refunds</option></select></Field>
        <button className="button soft">Add rule</button>
      </ActionForm>
    </div></section>)}
    <section className="card"><div className="card-header"><h2 className="card-title">New preset</h2></div><div className="card-body"><PresetForm accounts={accounts} projects={projects}/></div></section></div>
  </>;
}
