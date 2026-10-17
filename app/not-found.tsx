import Link from 'next/link';

export default function NotFound() {
  return <main className="empty-state">
    <h1>Pagina niet gevonden</h1>
    <p>Deze pagina bestaat niet of het opgevraagde gegeven is verwijderd.</p>
    <Link href="/" className="button primary">Naar het overzicht</Link>
  </main>;
}
