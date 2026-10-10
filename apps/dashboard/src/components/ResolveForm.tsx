import { useId, useState } from "react";
import type { ResolveCommentRequest } from "@perfect-front/shared";
import { parseResolveForm, type ResolveFormValues } from "../lib/resolve";

interface Props {
  busy: boolean;
  onSubmit: (request: ResolveCommentRequest) => void;
  onCancel: () => void;
}

export function ResolveForm({ busy, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [values, setValues] = useState<ResolveFormValues>({ summary: "", files: "", verification: "", commit: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof ResolveFormValues, string>>>({});
  const set = (k: keyof ResolveFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [k]: e.target.value });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const r = parseResolveForm(values);
    if (!r.ok) {
      setErrors(r.errors);
      const first = (["summary", "files", "verification", "commit"] as const).find((k) => r.errors[k]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setErrors({});
    onSubmit(r.request);
  };

  const field = (k: keyof ResolveFormValues, label: string, hint: string, multiline: boolean) => (
    <div className="db-field">
      <label htmlFor={`${uid}-${k}`}>{label}</label>
      {multiline ? (
        <textarea id={`${uid}-${k}`} className="pf-input db-textarea" rows={k === "summary" ? 3 : 2} value={values[k]} onChange={set(k)} aria-invalid={errors[k] !== undefined} aria-describedby={`${uid}-${k}-hint`} />
      ) : (
        <input id={`${uid}-${k}`} className="pf-input" value={values[k]} onChange={set(k)} aria-invalid={errors[k] !== undefined} aria-describedby={`${uid}-${k}-hint`} />
      )}
      <p id={`${uid}-${k}-hint`} className={errors[k] ? "db-error" : "db-muted"} role={errors[k] ? "alert" : undefined}>
        {errors[k] ?? hint}
      </p>
    </div>
  );

  return (
    <form className="db-card" onSubmit={submit} noValidate aria-label="Resolver comentario">
      <h3>Resolver comentario</h3>
      {field("summary", "Resumen (obligatorio)", "Qué cambiaste y por qué.", true)}
      {field("files", "Archivos modificados", "Uno por línea.", true)}
      {field("verification", "Verificación", "Una por línea: pruebas, build o revisión visual.", true)}
      {field("commit", "Commit (opcional)", "Hash o referencia.", false)}
      <div className="db-actions">
        <button type="submit" className="pf-btn pf-btn--primary" disabled={busy}>
          Marcar como resuelto
        </button>
        <button type="button" className="pf-btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
