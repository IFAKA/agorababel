import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '../../themeMode';

const options = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
] as const;

const nextModeByMode: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

export function ThemeModeControl({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const activeOption = options.find((option) => option.mode === mode) ?? options[2];
  const Icon = activeOption.icon;
  const nextMode = nextModeByMode[mode];
  const nextLabel = options.find((option) => option.mode === nextMode)?.label ?? 'Light';

  return (
    <button
      type="button"
      className="secondary-button pressable inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm"
      aria-label={`Theme mode: ${activeOption.label}. Switch to ${nextLabel}.`}
      title={`Theme: ${activeOption.label}. Click for ${nextLabel}.`}
      onClick={() => onChange(nextMode)}
    >
      <Icon aria-hidden="true" size={15} />
      <span className="hidden sm:inline">{activeOption.label}</span>
    </button>
  );
}
