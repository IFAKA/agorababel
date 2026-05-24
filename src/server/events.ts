import type { IncomingMessage, ServerResponse } from 'node:http';
import { methodNotAllowed, readJson, sendError, sendJson } from './http';

const eventNames = new Set([
  'source_submitted',
  'analysis_rejected',
  'analysis_failed',
  'market_accepted',
  'artifact_opened',
  'artifact_copied',
  'artifact_shared',
  'x402_unlock_started',
  'x402_unlock_completed',
  'x402_unlock_failed',
  'feedback_submitted',
]);

const events: ProductEvent[] = [];

export type ProductEvent = {
  eventName: string;
  artifactId?: string;
  runId?: string;
  stage?: string;
  sourceType?: 'text' | 'url';
  timestamp: string;
  sessionId: string;
};

export async function handleEventsRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    methodNotAllowed(request, response, 'events', 'POST');
    return;
  }

  const body = await readJson(request);
  const event = parseProductEvent(body);

  if (!event) {
    sendError(response, 400, 'Invalid product event.', 'events', 'Telemetry events must include a known eventName, timestamp, and sessionId.');
    return;
  }

  events.push(event);
  sendJson(response, 202, { ok: true });
}

export function getEventCounts() {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.eventName] = (counts[event.eventName] ?? 0) + 1;
    return counts;
  }, {});
}

function parseProductEvent(value: unknown): ProductEvent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (typeof record.eventName !== 'string' || !eventNames.has(record.eventName)) return null;
  if (typeof record.timestamp !== 'string' || typeof record.sessionId !== 'string') return null;

  return {
    eventName: record.eventName,
    artifactId: typeof record.artifactId === 'string' ? record.artifactId : undefined,
    runId: typeof record.runId === 'string' ? record.runId : undefined,
    stage: typeof record.stage === 'string' ? record.stage : undefined,
    sourceType: record.sourceType === 'text' || record.sourceType === 'url' ? record.sourceType : undefined,
    timestamp: record.timestamp,
    sessionId: record.sessionId,
  };
}
