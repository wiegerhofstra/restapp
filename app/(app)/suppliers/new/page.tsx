import { PageHeader } from '@/components/ui';
import { SupplierForm } from '../forms';
export default function NewSupplierPage(){return <><PageHeader title="Leverancier toevoegen" subtitle="Leg de vaste gegevens vast. Een btw-regel maakt u daarna vanuit een voorbeeldboeking aan."/><section className="card form-card"><div className="card-body"><SupplierForm/></div></section></>;}
