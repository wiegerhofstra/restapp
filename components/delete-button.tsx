"use client";

import { Trash2 } from "lucide-react";

export function DeleteButton({ action, label = "Delete", small = false }: { action: () => Promise<void>; label?: string; small?: boolean }) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Delete ${label.toLowerCase()}? This cannot be undone.`)) event.preventDefault(); }}><button className={`button danger ${small ? "small" : ""}`}><Trash2 size={small ? 13 : 15} />{label}</button></form>;
}
