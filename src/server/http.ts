import type { IncomingMessage, ServerResponse } from 'node:http';

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json;charset=utf-8');
  response.end(JSON.stringify(payload));
}

export function sendError(
  response: ServerResponse,
  statusCode: number,
  error: string,
  stage: string,
  likelyCause: string,
  details: string[] = [],
) {
  sendJson(response, statusCode, { error, stage, likelyCause, details });
}

export function methodNotAllowed(request: IncomingMessage, response: ServerResponse, stage: string, method: string) {
  sendError(response, 405, 'Method not allowed.', stage, `The ${stage} endpoint only accepts ${method} requests.`, [
    `Received method: ${request.method ?? 'unknown'}`,
  ]);
}
