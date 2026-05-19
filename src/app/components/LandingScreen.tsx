import { ArrowRight, Languages } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Screen } from '../App';

const workflow = ['Source', 'Reasoning', 'Decision', 'Artifact'];

export function LandingScreen({
  onNavigate,
}: {
  onNavigate: (screen: Screen) => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F7F6F1] text-[#191A1C]">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid min-h-full w-full max-w-6xl content-center gap-14 px-5 py-10 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-8 place-items-center rounded-md border border-[#D8D3C8] bg-white text-[#191A1C]">
                <Languages aria-hidden="true" size={17} />
              </div>
              <div className="text-sm font-semibold">AgoraBabel</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onNavigate('create')} className="primary-button pressable px-5">
                <span className="inline-flex items-center justify-center gap-2">
                  Start on /create
                  <ArrowRight aria-hidden="true" size={15} />
                </span>
              </button>
            </div>
          </header>

          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.23, 1, 0.32, 1] }}
            className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(25rem,0.7fr)] lg:items-end"
          >
            <div className="min-w-0">
              <p className="mb-5 text-sm font-medium text-[#6C6B66]">
                Local-language source into one validated market artifact.
              </p>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[0.98] tracking-normal text-[#171717] sm:text-6xl lg:text-7xl">
                Intelligence that unfolds into a decision.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-[#55534D]">
                AgoraBabel reads a non-English source, shows the agent reasoning, rejects weak markets, and leaves one publishable artifact.
              </p>
            </div>

            <article className="rounded-lg border border-[#DEDBD2] bg-white p-5 shadow-[0_24px_70px_rgba(29,28,24,0.08)]">
              <div className="mb-6 flex items-center justify-between gap-4 border-b border-[#ECE8DF] pb-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8A877D]">Source</div>
                  <div className="mt-1 text-sm font-medium text-[#242424]">Raw text or article URL</div>
                </div>
                <div className="rounded-full bg-[#F1EFE7] px-3 py-1 text-xs font-medium text-[#5F5C53]">
                  Real-data mode
                </div>
              </div>
              <h2 className="text-2xl font-semibold leading-tight text-[#191A1C]">Start from your own source.</h2>
              <p className="mt-5 text-base leading-7 text-[#5B5953]">
                The live workflow validates source text, rejects weak inputs, and only renders a market after the structured analysis passes.
              </p>
            </article>
          </motion.section>

          <nav aria-label="Workflow preview" className="grid gap-3 border-t border-[#E4E0D7] pt-6 sm:grid-cols-4">
            {workflow.map((step, index) => (
              <div key={step} className="flex items-center gap-3 text-sm text-[#6B6962]">
                <span className="grid size-7 place-items-center rounded-full bg-[#ECE8DF] text-xs font-semibold text-[#343330]">
                  {index + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </nav>
        </div>
      </main>
    </div>
  );
}
