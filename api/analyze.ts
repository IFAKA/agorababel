import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAnalyzeErrorPayload, handleAnalyzeRequest } from '../src/server/analyze.ts';
import { sendError } from '../src/server/http.ts';

export default async function analyzeApi(request: IncomingMessage, response: ServerResponse) {
  try {
    await handleAnalyzeRequest(request, response);
  } catch (error) {
    if (response.writableEnded) return;

    const payload = createAnalyzeErrorPayload(error);
    sendError(response, 500, payload.error, payload.stage, payload.likelyCause, payload.details);
  }
}
