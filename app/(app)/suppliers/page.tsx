import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { getSuppliers } from '@/lib/suppliers/service';
import { supplierRules } from '@/lib/vat/service';
import { rubricLabel } from '@/lib/vat/calculation';
export default async function SuppliersPage() {
  const suppliers=await getSuppliers(),rules=await supplierRules();
  return <><PageHeader eyebrow="Relaties" title="Leveranciers" subtitle="Vaste leveranciersgegevens en automatische btw-verwerking voor terugkerende boekingen."><Link className="button" href="/settings/presets">Boekingssjablonen</Link><Link className="button primary" href="/suppliers/new">Leverancier toevoegen</Link></PageHeader>
    <section className="card"><div className="card-body"><p>Bankmutaties worden automatisch aan leveranciers gekoppeld via naam, IBAN of herkenningsregels. Boekingssjablonen vullen de rekeningen bij een bankimport in. Leveranciersregels nemen daarna passende geboekte bedragen automatisch mee in de btw-aangifte. U controleert alleen afwijkingen en de complete kwartaalaangifte.</p></div>
      {suppliers.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Leverancier</th><th>Land / btw-identificatienummer</th><th>Btw-verwerking</th></tr></thead><tbody>{suppliers.map(s=>{const r=rules.find(r=>r.supplier_id===s.id);return <tr key={s.id}><td><Link className="row-link" href={`/suppliers/${s.id}`}>{s.name}</Link>{!s.active&&<span className="badge">Inactief</span>}</td><td>{s.country||'—'}<div className="secondary">{s.tax_number}</div></td><td>{r?.active&&s.active&&r.config.supplierVersion===s.version?<><span className="badge paid">Automatisch</span><div className="secondary">{r.config.code} · {rubricLabel(r.config.code)}</div></>:r?.active?'Regel opnieuw vaststellen':'Nog geen actieve btw-regel'}</td></tr>})}</tbody></table></div>:<div className="empty-state"><h2>Nog geen leveranciers</h2><p>Voeg een leverancier toe, of maak bij een btw-controle direct een leverancier met een vaste btw-regel aan.</p><Link className="button" href="/reports/vat">Naar de btw-aangifte</Link></div>}
    </section></>;
}
