export function ArtifactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--line-soft)] bg-[var(--surface-3)] p-3">
      <div className="eyebrow">{label}</div>
      <p className="mt-2 break-words text-sm leading-6 text-[var(--text-body)]">{value}</p>
    </div>
  );
}
