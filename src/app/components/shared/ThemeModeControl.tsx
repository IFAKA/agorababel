import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '../../themeMode';

const options = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
] as const;

export function ThemeModeControl({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <div
      className="pointer-events-auto fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-40 inline-flex rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] p-1 shadow-[0_12px_32px_var(--shadow-soft)]"
      role="group"
      aria-label="Theme mode"
    >
      {options.map(({ mode: optionMode, label, icon: Icon }) => {
        const active = mode === optionMode;

        return (
          <button
            key={optionMode}
            type="button"
            className={`pressable grid size-9 place-items-center rounded-[5px] ${active ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--text-subtle)] hover:bg-[var(--surface-3)] hover:text-[var(--text-strong)]'}`}
            aria-label={`${label} theme`}
            aria-pressed={active}
            title={`${label} theme`}
            onClick={() => onChange(optionMode)}
          >
            <Icon aria-hidden="true" size={15} />
          </button>
        );
      })}
    </div>
  );
}
