import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRuntimeStatusRequest } from '../src/server/analyze';

export default function handler(request: IncomingMessage, response: ServerResponse) {
  void handleRuntimeStatusRequest(request, response);
}
