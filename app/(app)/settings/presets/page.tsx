import { requireUser } from "@/lib/auth";
import { labelNl } from '@/lib/dutch';
import Link from 'next/link';
import { PageHeader, Field } from '@/components/ui';
import { rows } from '@/lib/db';
import { getPresets, getPresetRules, presetsReady } from '@/lib/presets/service';
import type { PostingAccount } from '@/components/preset-editor';
import { ActionForm } from '../../bank/forms';
import { PresetForm } from './preset-form';
import { addRuleAction, removeRuleAction } from './actions';

export default async function PresetsPage() {
  await requireUser();

  if (!await presetsReady()) return <><PageHeader title="Boekingssjablonen"/><p>Er zijn nog geen boekingssjablonen ingesteld.</p></>;
  const presets = await getPresets(true), rules = await getPresetRules();
  const accounts = await rows<PostingAccount>('SELECT id,name,kind FROM accounts WHERE can_post=1 ORDER BY name');
  const projects = await rows<{ id: number; name: string }>("SELECT p.id,c.name || ' · ' || p.name name FROM projects p JOIN customers c ON c.id=p.customer_id ORDER BY c.name,p.name");
  return <><PageHeader eyebrow="Instellingen" title="Boekingssjablonen" subtitle="Herbruikbare rekeningen en btw-berekeningen voor leveranciersbetalingen. Controleer iedere boeking voordat u deze verwerkt."><Link className="button" href="/suppliers">Leveranciers en btw-regels</Link><Link className="button" href="/bank">Bankafschriften</Link></PageHeader>
    <div className="grid">{presets.map(p => <section className="card" key={`${p.id}-${p.version}`}><div className="card-header"><h2 className="card-title">{p.name}</h2><span className={`badge ${p.active ? 'active' : 'draft'}`}>{p.active ? "Actief" : "Inactief"}</span></div><div className="card-body">
      <PresetForm preset={p} accounts={accounts} projects={projects}/><hr className="divider"/>
      <h3>Leveranciersherkenning</h3><p className="bank-help">Regels stellen dit sjabloon voor bij het controleren van een import. IBAN moet exact overeenkomen. Bij naam en omschrijving wordt gezocht naar de ingevoerde tekst. Bij meerdere overeenkomsten kiest u zelf. Verzamelbetalingen verwerkt u handmatig.</p>
      {rules.filter(r => r.preset_id === p.id).map(r => <div className="bank-toolbar" key={r.id}><span>{r.field === 'iban' ? "IBAN is gelijk aan" : `${labelNl(r.field)} bevat`} <strong>{r.pattern}</strong> · {labelNl(r.direction)}</span><ActionForm action={removeRuleAction.bind(null, r.id)}><button className="button small">Regel verwijderen</button></ActionForm></div>)}
      <ActionForm action={addRuleAction.bind(null, p.id)} className="preset-rule-form">
        <Field label="Herkenningsveld" name={`rule-field-${p.id}`}><select id={`rule-field-${p.id}`} name="field"><option value="name">Naam tegenpartij</option><option value="iban">IBAN tegenpartij</option><option value="description">Betalingsomschrijving</option></select></Field>
        <Field label="Zoektekst" name={`rule-pattern-${p.id}`}><input id={`rule-pattern-${p.id}`} name="pattern" minLength={3} maxLength={200} required/></Field>
        <Field label="Betalingsrichting" name={`rule-direction-${p.id}`}><select id={`rule-direction-${p.id}`} name="direction"><option value="payment">Betalingen</option><option value="refund">Terugbetalingen</option><option value="both">Betalingen en terugbetalingen</option></select></Field>
        <button className="button soft">Regel toevoegen</button>
      </ActionForm>
    </div></section>)}
    <section className="card"><div className="card-header"><h2 className="card-title">Nieuw boekingssjabloon</h2></div><div className="card-body"><PresetForm accounts={accounts} projects={projects}/></div></section></div>
  </>;
}
