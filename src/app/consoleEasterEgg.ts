const JUDGE_RECEIPT_COMMAND = 'window.agoraBabelJudgeReceipt()';
const DEMO_MARKET_SLUG = 'turkey-emergency-rate-intervention-2026';

declare global {
  interface Window {
    agoraBabelJudgeReceipt?: () => void;
  }
}

export function installConsoleEasterEgg() {
  if (typeof window === 'undefined') return;

  window.agoraBabelJudgeReceipt = printJudgeReceipt;

  if (typeof console === 'undefined') return;

  console.groupCollapsed('AgoraBabel Judge Brief');
  console.info('Thesis: local-language news -> validated prediction-market artifact.');
  console.info('Fast judging path: / -> Run sample analysis -> Open artifact.');
  console.info('Repo: https://github.com/IFAKA/agorababel');
  console.info(`Hidden command: ${JUDGE_RECEIPT_COMMAND}`);
  console.groupEnd();
}

function printJudgeReceipt() {
  const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const timestamp = new Date().toLocaleString();

  console.group('AgoraBabel Judge Receipt');
  console.info('Positioning: not a chatbot, a verified market artifact pipeline.');
  console.table([
    { stage: 'Extraction', artifact: 'Original-language source normalized' },
    { stage: 'Translation & Context', artifact: 'English operational summary and market relevance' },
    { stage: 'Market Drafting', artifact: 'Binary YES/NO market with deadline and resolution source' },
    { stage: 'Validation Review', artifact: 'Rejected weak candidates plus accepted defensible artifact' },
    { stage: 'Audit Trace', artifact: 'Trace hash prepared from structured analysis outputs' },
  ]);
  console.info('Audit trace: designed to make resolution criteria, rejected candidates, and source lineage inspectable.');
  console.info(`Current route: ${route || '/'}`);
  console.info(`Local timestamp: ${timestamp}`);
  console.info(`Demo market slug: ${DEMO_MARKET_SLUG}`);
  console.groupEnd();
}
