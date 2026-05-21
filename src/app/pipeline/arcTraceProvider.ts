import type { TracePayload, TraceProvider, TraceRecord } from './types';

type ExternalArcCommitResponse = {
  hash?: unknown;
  status?: unknown;
  timestamp?: unknown;
  transactionId?: unknown;
  explorerUrl?: unknown;
};

export class ArcTraceProvider implements TraceProvider {
  async commit(_payload: TracePayload): Promise<TraceRecord> {
    throw new Error('Arc testnet commit is not configured.');
  }

  protected mapCommitResponse(response: ExternalArcCommitResponse): TraceRecord {
    if (typeof response.hash !== 'string' || response.hash.trim().length === 0) {
      throw new Error('Arc trace hash missing.');
    }

    if (typeof response.timestamp !== 'string' || response.timestamp.trim().length === 0) {
      throw new Error('Arc response is missing timestamp.');
    }

    return {
      traceHash: response.hash,
      transactionId: typeof response.transactionId === 'string' ? response.transactionId : 'No Arc transaction returned',
      network: 'Arc Testnet',
      status: response.status === 'failed' ? 'failed' : 'pending',
      timestamp: response.timestamp,
      explorerUrl: typeof response.explorerUrl === 'string' ? response.explorerUrl : undefined,
    };
  }
}
