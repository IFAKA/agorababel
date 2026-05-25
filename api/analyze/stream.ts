import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAnalyzeErrorPayload, handleAnalyzeStreamRequest } from '../../src/server/analyze.ts';

export default async function analyzeStreamApi(request: IncomingMessage, response: ServerResponse) {
  try {
    await handleAnalyzeStreamRequest(request, response);
  } catch (error) {
    if (response.writableEnded) return;

    const payload = createAnalyzeErrorPayload(error);
    const event = {
      type: 'run-failed',
      stage: payload.stage,
      error: payload.error,
      likelyCause: payload.likelyCause,
      details: payload.details,
    };

    if (!response.headersSent) {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
    }

    response.write(`event: run-failed\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  }
}
