export function StatusDot({ status }: { status: 'complete' | 'active' | 'pending' | 'failed' }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}
