"use client";

import { Trash2 } from "lucide-react";

export function DeleteButton({ action, label = "Verwijderen", small = false }: { action: () => Promise<void>; label?: string; small?: boolean }) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Verwijder ${label.toLowerCase()}? Dit kan niet ongedaan worden gemaakt.`)) event.preventDefault(); }}>{small
    ? <button className="button danger small icon-only" aria-label={`${label} verwijderen`} title={`${label} verwijderen`}><Trash2 size={13} /></button>
    : <button className="button danger"><Trash2 size={15} />{label} verwijderen</button>}</form>;
}
