"use client";

import Link from 'next/link';
import { Field } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { parseAmount } from '@/lib/presets/calculation';
import type { Allocation, Preset } from '@/lib/presets/calculation';
export type PostingAccount = { id: number; name: string; kind: string };
export type DraftAllocation = { key: number; accountId: string; amount: string; memo: string };
export function draftAllocations(allocations: Allocation[]): DraftAllocation[] {
  return allocations.map((a, key) => ({ key, accountId: String(a.accountId), amount: (a.amountCents / 100).toFixed(2), memo: a.memo }));
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
    <div className="split-heading"><div><h2>Posting preset</h2><p className="card-description">Fill the accounts, then review the entries before posting.</p></div><Link className="row-link" href="/settings/presets">Manage presets</Link></div>
    {suggestions.length > 0 && <p className="bank-help">{suggestions.length === 1 ? 'Suggested from the supplier details' : 'Several presets match; choose the appropriate one'}: {presets.filter(p => suggestions.includes(p.id)).map(p => p.name).join(', ')}.</p>}
    <div className="bank-toolbar"><Field label="Preset" name="preset-choice"><select id="preset-choice" value={selected} onChange={e => onSelect(e.target.value)}><option value="">Choose a preset</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}{suggestions.includes(p.id) ? ' · suggested' : ''}</option>)}</select></Field><button type="button" className="button soft" disabled={!selected || disabled} onClick={onApply}>Apply preset</button></div>
    <p className="secondary">Applying a preset replaces the draft allocations below. Nothing is posted yet.</p>
  </div>;
}
export function AllocationEditor({ allocations, onChange, accounts, bankAccountId, amountCents }: {
  allocations: DraftAllocation[]; onChange: (rows: DraftAllocation[]) => void; accounts: PostingAccount[]; bankAccountId: number; amountCents: number;
}) {
  const remaining = Math.abs(amountCents) - draftTotal(allocations);
  const update = (key: number, patch: Partial<DraftAllocation>) => onChange(allocations.map(a => a.key === key ? { ...a, ...patch } : a));
  return <>
    <div className="bank-allocations">{allocations.map((a, index) => <div className="bank-allocation" key={a.key}>
      <Field label={`Account ${index + 1}`} name={`allocation-${a.key}`}><select id={`allocation-${a.key}`} name="allocation_account" value={a.accountId} onChange={e => update(a.key, { accountId: e.target.value })} required><option value="">Choose account</option>{accounts.filter(x => x.id !== bankAccountId).map(x => <option key={x.id} value={x.id}>{x.name} ({x.kind})</option>)}</select></Field>
      <Field label="Amount" name={`amount-${a.key}`}><input id={`amount-${a.key}`} name="allocation_amount" inputMode="decimal" value={a.amount} required onChange={e => update(a.key, { amount: e.target.value })}/></Field>
      <Field label="Memo" name={`memo-${a.key}`}><input id={`memo-${a.key}`} name="allocation_memo" value={a.memo} maxLength={500} onChange={e => update(a.key, { memo: e.target.value })}/></Field>
      <button type="button" className="button small" disabled={allocations.length === 1} aria-label={`Remove allocation ${index + 1}`} onClick={() => onChange(allocations.filter(x => x.key !== a.key))}>Remove</button>
    </div>)}</div>
    <div className="bank-toolbar"><button type="button" className="button small" disabled={allocations.length >= 50} onClick={() => onChange([...allocations, { key: Math.max(-1, ...allocations.map(a => a.key)) + 1, accountId: '', amount: Number.isFinite(remaining) && remaining ? (remaining / 100).toFixed(2) : '', memo: '' }])}>Add allocation</button><span className={remaining ? 'bank-warning' : 'bank-ok'}>{Number.isFinite(remaining) ? remaining ? `${formatMoney(remaining)} left to allocate` : 'Fully allocated' : 'Enter valid amounts'}</span></div>
    <LedgerPreview allocations={allocations} accounts={accounts} bankAccountId={bankAccountId} amountCents={amountCents}/>
  </>;
}
export function LedgerPreview({ allocations, accounts, bankAccountId, amountCents }: { allocations: DraftAllocation[]; accounts: PostingAccount[]; bankAccountId: number; amountCents: number }) {
  const lines = [{ accountId: bankAccountId, signed: amountCents }, ...allocations.map(a => {
    let value = NaN; try { value = parseAmount(a.amount); } catch {}
    return { accountId: Number(a.accountId), signed: value * (amountCents < 0 ? 1 : -1) };
  })];
  return <div className="preset-preview"><h3>Ledger preview{amountCents > 0 ? ' · refund' : ''}</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Account</th><th className="numeric">Debit</th><th className="numeric">Credit</th></tr></thead><tbody>{lines.map((l, i) => <tr key={i}><td>{accounts.find(a => a.id === l.accountId)?.name ?? 'Choose account'}</td><td className="numeric">{Number.isFinite(l.signed) ? l.signed > 0 ? formatMoney(l.signed) : '—' : 'Invalid amount'}</td><td className="numeric">{Number.isFinite(l.signed) ? l.signed < 0 ? formatMoney(-l.signed) : '—' : 'Invalid amount'}</td></tr>)}</tbody></table></div></div>;
}
