export function CriteriaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line-soft)] bg-[var(--surface-3)] p-4">
      <p className="text-sm font-medium text-[var(--text-subtle)]">{label}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--text-body)]">{value}</p>
    </div>
  );
}
