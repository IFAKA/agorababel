import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAnalyzeRequest } from '../src/server/analyze.ts';

export default function handler(request: IncomingMessage, response: ServerResponse) {
  void handleAnalyzeRequest(request, response);
}
