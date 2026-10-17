'use client';

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className="empty-state" role="alert">
    <h1>Er is iets misgegaan</h1>
    <p>De pagina kon niet worden geladen. Probeer het opnieuw.</p>
    <button type="button" className="button primary" onClick={() => retry()}>Opnieuw proberen</button>
  </div>;
}
