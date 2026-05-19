import type { IncomingMessage, ServerResponse } from 'node:http';

export default function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: 'Method not allowed.',
      stage: 'runtime-status',
      likelyCause: 'The runtime status endpoint only accepts GET requests.',
      details: [`Received method: ${request.method ?? 'unknown'}`],
    });
    return;
  }

  const provider = (process.env.ANALYSIS_PROVIDER ?? 'local').toLowerCase();

  sendJson(response, 200, {
    status: 'active',
    provider,
    model: getAnalysisModel(provider),
    tool: getAnalysisTool(provider),
    runtime: provider === 'local' ? 'server-local' : 'remote-llm',
    usesLlm: provider !== 'local',
    stagePacing: process.env.VITE_DEMO_PACING === 'true',
    checkedAt: new Date().toISOString(),
  });
}

function getAnalysisModel(provider: string) {
  if (provider === 'groq') return process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';
  if (provider === 'openai') return process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  if (provider === 'ollama') return process.env.OLLAMA_MODEL ?? 'llama3.2:3b-32k';
  return 'none';
}

function getAnalysisTool(provider: string) {
  if (provider === 'groq') return 'Groq Chat Completions API';
  if (provider === 'openai') return 'OpenAI Responses API';
  if (provider === 'ollama') return 'Ollama local chat API';
  return 'Built-in TypeScript rule engine';
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json;charset=utf-8');
  response.end(JSON.stringify(payload));
}
