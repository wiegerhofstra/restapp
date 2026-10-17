"use client";
import { labelNl } from '@/lib/dutch';

import Link from 'next/link';
import { Field } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { parseAmount } from '@/lib/presets/calculation';
import type { Allocation, Preset } from '@/lib/presets/calculation';
export type PostingAccount = { id: number; name: string; kind: string };
export type DraftAllocation = { key: number; accountId: string; amount: string; memo: string };
export function draftAllocations(allocations: Allocation[]): DraftAllocation[] {
  return allocations.map((a, key) => ({ key, accountId: String(a.accountId), amount: (a.amountCents / 100).toFixed(2).replace('.',','), memo: a.memo }));
}
export function draftTotal(allocations: DraftAllocation[]) {
  try {
    const total = allocations.reduce((n, a) => n + BigInt(parseAmount(a.amount)), BigInt(0));
    return total <= BigInt(Number.MAX_SAFE_INTEGER) && total >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : NaN;
  } catch { return NaN; }
}
export function PresetPicker({ presets, selected, onSelect, onApply, suggestions = [], disabled = false }: {
  presets: Preset[]; selected: string; onSelect: (id: string) => void; onApply: () => void; suggestions?: number[]; disabled?: boolean;
}) {
  return <div className="preset-picker">
    <div className="split-heading"><div><h2>Boekingssjabloon</h2><p className="card-description">Vul de rekeningen in en controleer de regels voordat u boekt.</p></div><Link className="row-link" href="/settings/presets">Sjablonen beheren</Link></div>
    {suggestions.length > 0 && <p className="bank-help">{suggestions.length === 1 ? "Voorgesteld op basis van leveranciersgegevens" : "Meerdere sjablonen komen overeen. Kies het juiste sjabloon."}: {presets.filter(p => suggestions.includes(p.id)).map(p => p.name).join(', ')}.</p>}
    <div className="bank-toolbar"><Field label="Sjabloon" name="preset-choice"><select id="preset-choice" value={selected} onChange={e => onSelect(e.target.value)}><option value="">Kies een sjabloon</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}{suggestions.includes(p.id) ? " · voorgesteld" : ''}</option>)}</select></Field><button type="button" className="button soft" disabled={!selected || disabled} onClick={onApply}>Sjabloon toepassen</button></div>
    <p className="secondary">Het toepassen van een sjabloon vervangt de onderstaande conceptregels. Er wordt nog niets geboekt.</p>
  </div>;
}
export function AllocationEditor({ allocations, onChange, accounts, bankAccountId, amountCents }: {
  allocations: DraftAllocation[]; onChange: (rows: DraftAllocation[]) => void; accounts: PostingAccount[]; bankAccountId: number; amountCents: number;
}) {
  const remaining = Math.abs(amountCents) - draftTotal(allocations);
  const update = (key: number, patch: Partial<DraftAllocation>) => onChange(allocations.map(a => a.key === key ? { ...a, ...patch } : a));
  return <>
    <div className="bank-allocations">{allocations.map((a, index) => <div className="bank-allocation" key={a.key}>
      <Field label={`Grootboekrekening ${index + 1}`} name={`allocation-${a.key}`}><select id={`allocation-${a.key}`} name="allocation_account" value={a.accountId} onChange={e => update(a.key, { accountId: e.target.value })} required><option value="">Kies een grootboekrekening</option>{accounts.filter(x => x.id !== bankAccountId).map(x => <option key={x.id} value={x.id}>{x.name} ({labelNl(x.kind)})</option>)}</select></Field>
      <Field label="Bedrag" name={`amount-${a.key}`}><input id={`amount-${a.key}`} name="allocation_amount" inputMode="decimal" value={a.amount} required onChange={e => update(a.key, { amount: e.target.value })}/></Field>
      <Field label="Toelichting" name={`memo-${a.key}`}><input id={`memo-${a.key}`} name="allocation_memo" value={a.memo} maxLength={500} onChange={e => update(a.key, { memo: e.target.value })}/></Field>
      <button type="button" className="button small" disabled={allocations.length === 1} aria-label={`Boekingsregel verwijderen ${index + 1}`} onClick={() => onChange(allocations.filter(x => x.key !== a.key))}>Verwijderen</button>
    </div>)}</div>
    <div className="bank-toolbar"><button type="button" className="button small" disabled={allocations.length >= 50} onClick={() => onChange([...allocations, { key: Math.max(-1, ...allocations.map(a => a.key)) + 1, accountId: '', amount: Number.isFinite(remaining) && remaining ? (remaining / 100).toFixed(2).replace('.',',') : '', memo: '' }])}>Boekingsregel toevoegen</button><span className={remaining ? 'bank-warning' : 'bank-ok'}>{Number.isFinite(remaining) ? remaining ? `${formatMoney(remaining)} nog te verdelen` : "Volledig verdeeld" : "Vul geldige bedragen in"}</span></div>
    <LedgerPreview allocations={allocations} accounts={accounts} bankAccountId={bankAccountId} amountCents={amountCents}/>
  </>;
}
export function LedgerPreview({ allocations, accounts, bankAccountId, amountCents }: { allocations: DraftAllocation[]; accounts: PostingAccount[]; bankAccountId: number; amountCents: number }) {
  const lines = [{ accountId: bankAccountId, signed: amountCents }, ...allocations.map(a => {
    let value = NaN; try { value = parseAmount(a.amount); } catch {}
    return { accountId: Number(a.accountId), signed: value * (amountCents < 0 ? 1 : -1) };
  })];
  return <div className="preset-preview"><h3>Boekingsvoorbeeld{amountCents > 0 ? " · terugbetaling" : ''}</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Grootboekrekening</th><th className="numeric">Debet</th><th className="numeric">Credit</th></tr></thead><tbody>{lines.map((l, i) => <tr key={i}><td>{accounts.find(a => a.id === l.accountId)?.name ?? "Kies een grootboekrekening"}</td><td className="numeric">{Number.isFinite(l.signed) ? l.signed > 0 ? formatMoney(l.signed) : '—' : "Ongeldig bedrag"}</td><td className="numeric">{Number.isFinite(l.signed) ? l.signed < 0 ? formatMoney(-l.signed) : '—' : "Ongeldig bedrag"}</td></tr>)}</tbody></table></div></div>;
}
