import { Clock3 } from 'lucide-react';

export function Runtime({ runtimeMs }: { runtimeMs: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--text-subtle)]">
      <Clock3 aria-hidden="true" size={14} />
      {(runtimeMs / 1000).toFixed(1)}s
    </span>
  );
}
