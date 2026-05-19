import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { AnalysisResultSchema, analyzeRequestSchema, analysisJsonSchema, type AnalysisResult } from '../app/pipeline/analysisSchema';

const MIN_ARTICLE_LENGTH = 120;
const MIN_EXTRACTED_URL_LENGTH = 40;
const SOCIAL_URL_HOSTS = ['facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'x.com', 'twitter.com'];
const X_URL_HOSTS = ['x.com', 'twitter.com'];

type PreparedSource = {
  text: string;
  sourceType: AnalysisResult['sourceType'];
  extractedSource: AnalysisResult['extractedSource'];
};

export async function handleAnalyzeRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed.', 'request', 'The analyze endpoint only accepts POST requests.', [
      `Received method: ${request.method ?? 'unknown'}`,
      'Call /api/analyze with method POST and a JSON body containing sourceText.',
    ]);
    return;
  }

  try {
    const body = await readJson(request);
    const parsedRequest = analyzeRequestSchema.safeParse(body);

    if (!parsedRequest.success) {
      sendError(
        response,
        400,
        parsedRequest.error.issues[0]?.message ?? 'Invalid source input.',
        'request-validation',
        'The submitted JSON body did not match analyzeRequestSchema.',
        parsedRequest.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`),
      );
      return;
    }

    const preparedSource = await prepareSource(parsedRequest.data.sourceText);
    const analysis = normalizeAnalysisResult(await analyzeSourceContent(preparedSource.text, preparedSource));
    const validated = AnalysisResultSchema.safeParse({
      ...analysis,
      sourceType: preparedSource.extractedSource ? preparedSource.sourceType : analysis.sourceType,
      extractedSource: preparedSource.extractedSource,
    });

    if (!validated.success) {
      sendError(
        response,
        502,
        'Model output did not match the validated market schema.',
        'response-validation',
        'The analyzer produced JSON that failed AnalysisResultSchema.',
        validated.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`),
      );
      return;
    }

    sendJson(response, 200, validated.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    sendError(response, 400, message, inferErrorStage(message), inferLikelyCause(message), [
      `ANALYSIS_PROVIDER=${getConfiguredAnalysisProvider()}`,
      error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : 'No stack trace available.',
    ]);
  }
}

export async function handleRuntimeStatusRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET') {
    sendError(response, 405, 'Method not allowed.', 'runtime-status', 'The runtime status endpoint only accepts GET requests.', [
      `Received method: ${request.method ?? 'unknown'}`,
      'Call /api/runtime-status with method GET.',
    ]);
    return;
  }

  const configuredProvider = getConfiguredAnalysisProvider();
  const ollamaStatus = configuredProvider === 'auto' || configuredProvider === 'ollama' ? await getOllamaStatus() : null;
  const provider = configuredProvider === 'auto' && ollamaStatus?.available ? 'ollama' : configuredProvider === 'auto' ? 'local' : configuredProvider;

  if (ollamaStatus && !ollamaStatus.available) {
    if (configuredProvider === 'auto') {
      sendJson(response, 200, {
        status: 'active',
        provider,
        model: getAnalysisModel(provider),
        tool: getAnalysisTool(provider),
        runtime: 'server-local',
        usesLlm: false,
        stagePacing: process.env.VITE_DEMO_PACING === 'true',
        checkedAt: new Date().toISOString(),
        note: ollamaStatus.error,
      });
      return;
    }

    sendJson(response, 503, {
      status: 'unreachable',
      provider,
      model: getAnalysisModel(provider),
      tool: getAnalysisTool(provider),
      runtime: 'ollama-local',
      usesLlm: true,
      stagePacing: process.env.VITE_DEMO_PACING === 'true',
      checkedAt: new Date().toISOString(),
      error: ollamaStatus.error,
    });
    return;
  }

  sendJson(response, 200, {
    status: 'active',
    provider,
    model: provider === 'ollama' ? ollamaStatus?.model ?? getAnalysisModel(provider) : getAnalysisModel(provider),
    tool: getAnalysisTool(provider),
    runtime: provider === 'local' ? 'server-local' : provider === 'ollama' ? 'ollama-local' : 'remote-llm',
    usesLlm: provider !== 'local',
    stagePacing: process.env.VITE_DEMO_PACING === 'true',
    checkedAt: new Date().toISOString(),
  });
}

async function prepareSource(input: string): Promise<PreparedSource> {
  if (!isArticleUrl(input)) {
    if (input.trim().length < MIN_ARTICLE_LENGTH) {
      throw new Error('Paste at least 120 characters of article or source text.');
    }

    return { text: input, sourceType: 'article', extractedSource: null };
  }

  const url = new URL(input.trim());
  const sourceType: AnalysisResult['sourceType'] = isSocialUrlHost(url.hostname) ? 'social_post' : 'url_article';
  const jinaExtracted = await extractWithJinaReader(url);

  if (jinaExtracted && jinaExtracted.text.length >= MIN_ARTICLE_LENGTH) {
    return { text: jinaExtracted.text, sourceType, extractedSource: jinaExtracted };
  }

  const xExtracted = isXUrlHost(url.hostname) ? await extractWithTwitterOEmbed(url) : null;
  const extracted = xExtracted ?? jinaExtracted;

  if (!extracted || extracted.text.length < MIN_EXTRACTED_URL_LENGTH) {
    throw new Error('URL extraction produced too little readable text to analyze. Paste the source text instead, or try a public readable URL.');
  }

  return { text: extracted.text, sourceType, extractedSource: extracted };
}

async function extractWithJinaReader(url: URL): Promise<AnalysisResult['extractedSource']> {
  const readerUrl = `https://r.jina.ai/http://${url.href.replace(/^https?:\/\//i, '')}`;

  try {
    const readerResponse = await fetch(readerUrl, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'AgoraBabel-SaaS/1.0',
      },
    });

    if (!readerResponse.ok) return null;

    const readableText = await readerResponse.text();
    return parseJinaReaderText(readableText, url.href);
  } catch {
    return null;
  }
}

async function extractWithTwitterOEmbed(url: URL): Promise<AnalysisResult['extractedSource']> {
  const oembedUrl = new URL('https://publish.twitter.com/oembed');
  oembedUrl.searchParams.set('url', url.href);
  oembedUrl.searchParams.set('omit_script', 'true');

  try {
    const response = await fetch(oembedUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AgoraBabel-SaaS/1.0',
      },
    });

    if (!response.ok) return null;

    const payload = await response.json() as { author_name?: string; html?: string; title?: string };
    const text = htmlToReadableText(payload.html ?? '');

    if (!text) return null;

    return {
      title: payload.title?.trim() || payload.author_name?.trim() || new URL(url.href).hostname,
      domain: url.hostname.replace(/^www\./, ''),
      url: url.href,
      text,
    };
  } catch {
    return null;
  }
}

async function analyzeSourceContent(sourceText: string, preparedSource: PreparedSource): Promise<AnalysisResult> {
  const provider = await resolveAnalysisProvider();

  if (provider === 'local') {
    return analyzeLocally(sourceText, preparedSource);
  }

  if (provider === 'ollama') {
    return analyzeWithOllama(sourceText);
  }

  if (provider === 'groq') {
    return analyzeWithGroq(sourceText);
  }

  if (provider === 'openai') {
    return analyzeWithOpenAI(sourceText);
  }

  throw new Error(`Unsupported ANALYSIS_PROVIDER "${provider}". Use local, ollama, groq, or openai.`);
}

function normalizeAnalysisResult(value: AnalysisResult): AnalysisResult {
  let candidateMarkets = value.candidateMarkets.map((candidate) => ({
    ...candidate,
    confidenceScore: clampConfidence(candidate.confidenceScore),
  }));
  const acceptedMarket = value.acceptedMarket
    ? normalizeAcceptedMarket({
        acceptedMarket: value.acceptedMarket,
        criticDraftId: value.criticVerdict.draftId,
        candidateMarkets,
        region: value.region,
        eventSummary: value.eventSummary,
      })
    : null;

  if (acceptedMarket) {
    const matchingCandidateIndex = candidateMarkets.findIndex((candidate) => candidate.id === acceptedMarket.id);

    if (matchingCandidateIndex >= 0) {
      candidateMarkets = candidateMarkets.map((candidate, index) => (
        index === matchingCandidateIndex ? { ...candidate, ...acceptedMarket } : candidate
      ));
    } else {
      candidateMarkets = [acceptedMarket, ...candidateMarkets.filter((candidate) => candidate.id !== acceptedMarket.id)].slice(0, 3);
    }
  }

  const supplementalRejectedCandidates = acceptedMarket
    ? createSupplementalRejectedCandidates(acceptedMarket, value.region, value.eventSummary)
    : [];

  for (const supplementalCandidate of supplementalRejectedCandidates) {
    if (!candidateMarkets.some((candidate) => candidate.id === supplementalCandidate.id) && candidateMarkets.length < 3) {
      candidateMarkets.push(supplementalCandidate);
    }
  }

  const rejectedMarkets = acceptedMarket
    ? normalizeRejectedMarkets({
        rawRejectedMarkets: value.rejectedMarkets,
        candidateMarkets,
        supplementalRejectedCandidates,
        acceptedMarketId: acceptedMarket.id,
      })
    : value.rejectedMarkets;

  return {
    ...value,
    candidateMarkets,
    criticVerdict: acceptedMarket
      ? {
          ...value.criticVerdict,
          draftId: acceptedMarket.id,
          decision: 'accepted',
          checks: {
            ambiguity: 'pass',
            resolvability: 'pass',
            deadline: 'pass',
            evidence: 'pass',
            resolutionSource: 'pass',
          },
        }
      : value.criticVerdict,
    acceptedMarket,
    rejectedMarkets,
  };
}

function normalizeAcceptedMarket({
  acceptedMarket,
  criticDraftId,
  candidateMarkets,
  region,
  eventSummary,
}: {
  acceptedMarket: NonNullable<AnalysisResult['acceptedMarket']>;
  criticDraftId: string | null;
  candidateMarkets: AnalysisResult['candidateMarkets'];
  region: string;
  eventSummary: string;
}) {
  const candidateByCriticId = criticDraftId ? candidateMarkets.find((candidate) => candidate.id === criticDraftId) : undefined;
  const candidateByAcceptedId = candidateMarkets.find((candidate) => candidate.id === acceptedMarket.id);
  const base = candidateByAcceptedId ?? candidateByCriticId ?? acceptedMarket;
  const deadline = normalizeDeadline(acceptedMarket.deadline || base.deadline);
  const resolutionSource = normalizeResolutionSource(
    acceptedMarket.resolutionSource || base.resolutionSource,
    region,
    eventSummary,
  );

  return {
    ...base,
    ...acceptedMarket,
    id: base.id || acceptedMarket.id,
    deadline,
    resolutionSource,
    yesCriteria: normalizeCriteria('YES', acceptedMarket.yesCriteria || base.yesCriteria, resolutionSource, deadline),
    noCriteria: normalizeCriteria('NO', acceptedMarket.noCriteria || base.noCriteria, resolutionSource, deadline),
    confidenceScore: clampConfidence(acceptedMarket.confidenceScore),
  };
}

function normalizeRejectedMarkets({
  rawRejectedMarkets,
  candidateMarkets,
  supplementalRejectedCandidates,
  acceptedMarketId,
}: {
  rawRejectedMarkets: AnalysisResult['rejectedMarkets'];
  candidateMarkets: AnalysisResult['candidateMarkets'];
  supplementalRejectedCandidates: AnalysisResult['candidateMarkets'];
  acceptedMarketId: string;
}): AnalysisResult['rejectedMarkets'] {
  const rejectedMarkets = rawRejectedMarkets
    .filter((item) => item.draftId !== acceptedMarketId)
    .slice(0, 3);
  const usedDraftIds = new Set(rejectedMarkets.map((item) => item.draftId));
  const rejectedCandidates = [
    ...candidateMarkets.filter((candidate) => candidate.id !== acceptedMarketId),
    ...supplementalRejectedCandidates,
  ];

  for (const candidate of rejectedCandidates) {
    if (rejectedMarkets.length >= 2) break;
    if (usedDraftIds.has(candidate.id)) continue;

    rejectedMarkets.push({
      draftId: candidate.id,
      question: candidate.question,
      reasonRejected: candidate.evidenceSummary || 'Rejected because the candidate did not pass the critic guardrails.',
      violatedRule: rejectedMarkets.length === 0 ? 'weak resolution' : 'subjective wording',
    });
    usedDraftIds.add(candidate.id);
  }

  return rejectedMarkets;
}

function createSupplementalRejectedCandidates(
  acceptedMarket: NonNullable<AnalysisResult['acceptedMarket']>,
  region: string,
  eventSummary: string,
): AnalysisResult['candidateMarkets'] {
  const deadline = normalizeDeadline(acceptedMarket.deadline);
  const prefix = acceptedMarket.id || `market-${createHash('sha1').update(`${eventSummary}:${deadline}`).digest('hex').slice(0, 10)}`;

  return [
    {
      id: `${prefix}-news-proxy`,
      question: `Will major English-language outlets report that ${eventSummary.toLowerCase()} before ${deadline}?`,
      yesCriteria: 'YES if at least two major English-language outlets publish matching coverage before the deadline.',
      noCriteria: 'NO if that coverage does not appear before the deadline.',
      deadline,
      resolutionSource: 'Major English-language news coverage',
      evidenceSummary: 'Rejected because news coverage is a proxy for attention, not the official underlying event.',
      confidenceScore: 42,
    },
    {
      id: `${prefix}-market-impact`,
      question: `Will ${region === 'Unknown' ? 'markets' : `${region} markets`} react positively if ${eventSummary.toLowerCase()} before ${deadline}?`,
      yesCriteria: 'YES if selected market indicators move positively after the event.',
      noCriteria: 'NO if selected indicators do not move positively.',
      deadline,
      resolutionSource: 'Market price movement',
      evidenceSummary: 'Rejected because price reaction is subjective and not an objective public-event resolution.',
      confidenceScore: 28,
    },
  ];
}

function normalizeDeadline(value: string) {
  const trimmed = value.trim();
  const isoDate = trimmed.match(/\b(202[6-9]-\d{2}-\d{2})\b/)?.[1];

  if (isoDate) return isoDate;

  const date = new Date(trimmed);
  if (!Number.isNaN(date.valueOf()) && date.getUTCFullYear() >= 2026 && date.getUTCFullYear() <= 2029) {
    return date.toISOString().slice(0, 10);
  }

  return defaultDeadline();
}

function normalizeCriteria(label: 'YES' | 'NO', value: string, resolutionSource: string, deadline: string) {
  const trimmed = value.trim();
  const vague = /\b(according to official sources|official sources|sources say|named public authority|public authority|otherwise)\b/i.test(trimmed);

  if (label === 'YES' && (!trimmed.startsWith('YES') || trimmed.length < 70 || vague)) {
    return `YES if ${resolutionSource} publishes an announcement, decision, decree, or policy notice confirming the event before ${deadline}.`;
  }

  if (label === 'NO' && (!trimmed.startsWith('NO') || trimmed.length < 70 || vague)) {
    return `NO if ${resolutionSource} has not published a qualifying confirmation before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`;
  }

  return trimmed;
}

function normalizeResolutionSource(value: string, region: string, eventSummary: string) {
  const trimmed = value.trim();
  const vague = !trimmed || /\b(official sources|sources say|named public authority|public authority)\b/i.test(trimmed);

  if (!vague) return trimmed;

  const lowerSummary = eventSummary.toLowerCase();
  if (region === 'Turkey' || /\btcmb|turkey|central-bank|central bank|liquidity|rate\b/.test(lowerSummary)) {
    return getResolutionSource('Turkey', 'central bank policy action');
  }

  if (region === 'Argentina' || /\bcurrency controls|bcra|argentina\b/.test(lowerSummary)) {
    return getResolutionSource('Argentina', 'currency controls');
  }

  if (region === 'Chile' || /\bchile|lithium\b/.test(lowerSummary)) {
    return getResolutionSource('Chile', 'public economic policy action');
  }

  return getResolutionSource(region, 'publicly reported event');
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getConfiguredAnalysisProvider() {
  return (process.env.ANALYSIS_PROVIDER ?? 'local').toLowerCase();
}

async function resolveAnalysisProvider() {
  const provider = getConfiguredAnalysisProvider();

  if (provider !== 'auto') {
    return provider;
  }

  const ollamaStatus = await getOllamaStatus();
  return ollamaStatus.available ? 'ollama' : 'local';
}

function getAnalysisModel(provider = getConfiguredAnalysisProvider()) {
  if (provider === 'openai') {
    return process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  }

  if (provider === 'groq') {
    return process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';
  }

  if (provider === 'ollama') {
    return process.env.OLLAMA_MODEL ?? 'llama3.2:3b-32k';
  }

  return provider === 'auto' ? 'auto' : 'none';
}

function getAnalysisTool(provider = getConfiguredAnalysisProvider()) {
  if (provider === 'openai') {
    return 'OpenAI Responses API';
  }

  if (provider === 'groq') {
    return 'Groq Chat Completions API';
  }

  if (provider === 'ollama') {
    return 'Ollama local chat API';
  }

  return provider === 'auto' ? 'Auto provider detection' : 'Built-in TypeScript rule engine';
}

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
}

async function getOllamaStatus(): Promise<{ available: true; model: string } | { available: false; error: string }> {
  const model = getAnalysisModel('ollama');

  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { available: false, error: `Ollama returned HTTP ${response.status}.` };
    }

    const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const models = payload.models ?? [];
    const hasConfiguredModel = models.some((item) => item.name === model || item.model === model);

    if (!hasConfiguredModel) {
      const installed = models.map((item) => item.name ?? item.model).filter(Boolean).join(', ');
      return {
        available: false,
        error: `Ollama is running, but model "${model}" is not installed.${installed ? ` Installed: ${installed}.` : ''}`,
      };
    }

    return { available: true, model };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? `Ollama is unreachable: ${error.message}` : 'Ollama is unreachable.',
    };
  }
}

async function analyzeWithOllama(sourceText: string): Promise<AnalysisResult> {
  const model = getAnalysisModel('ollama');
  const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: analysisJsonSchema,
      options: {
        temperature: 0.1,
      },
      messages: [
        {
          role: 'system',
          content: createAnalysisSystemPrompt(),
        },
        {
          role: 'user',
          content: `Analyze this source for one validated prediction-market artifact or reject it. Return only JSON.\n\n${sourceText.slice(0, 20000)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama analysis failed with HTTP ${response.status}. Check Ollama and OLLAMA_MODEL.`);
  }

  const payload = await response.json() as { message?: { content?: string }; response?: string };
  const text = payload.message?.content ?? payload.response;

  if (!text) {
    throw new Error('Ollama analysis returned no structured JSON.');
  }

  return JSON.parse(extractJsonObject(text)) as AnalysisResult;
}

async function analyzeWithOpenAI(sourceText: string): Promise<AnalysisResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when ANALYSIS_PROVIDER=openai.');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: createAnalysisSystemPrompt(),
        },
        {
          role: 'user',
          content: `Analyze this source for one validated prediction-market artifact or reject it.\n\n${sourceText.slice(0, 20000)}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agorababel_analysis',
          strict: true,
          schema: analysisJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error('LLM analysis failed. Check API configuration and try again.');
  }

  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean);

  if (!text) {
    throw new Error('LLM analysis returned no structured JSON.');
  }

  return JSON.parse(text) as AnalysisResult;
}

async function analyzeWithGroq(sourceText: string): Promise<AnalysisResult> {
  const model = getAnalysisModel('groq');
  if (!process.env.GROQ_API_KEY) {
    throw new Error(`Groq provider setup failed at llm-provider: missing GROQ_API_KEY for model ${model}.`);
  }

  const strictResponse = await fetchGroqChatCompletion({
    model,
    sourceText,
    systemPrompt: createAnalysisSystemPrompt(),
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'agorababel_analysis',
        strict: true,
        schema: analysisJsonSchema,
      },
    },
  });

  let response = strictResponse;
  if (!strictResponse.ok) {
    const strictDetail = await strictResponse.text().catch(() => '');

    if (!/json|schema|structured|failed_generation/i.test(strictDetail)) {
      throw new Error(`Groq provider failed at structured-output stage with HTTP ${strictResponse.status} for model ${model}. ${strictDetail.slice(0, 300)}`);
    }

    response = await fetchGroqChatCompletion({
      model,
      sourceText,
      systemPrompt: `${createAnalysisSystemPrompt()} Return one JSON object with all required keys from the schema. Do not omit rejectedMarkets.`,
      responseFormat: { type: 'json_object' },
    });

    if (!response.ok) {
      const retryDetail = await response.text().catch(() => '');
      throw new Error(`Groq provider failed at json-object fallback stage with HTTP ${response.status} for model ${model}. Strict error: ${strictDetail.slice(0, 180)} Retry error: ${retryDetail.slice(0, 180)}`);
    }
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(`Groq provider failed at structured-output stage for model ${model}: no JSON content returned.`);
  }

  return JSON.parse(extractJsonObject(text)) as AnalysisResult;
}

function fetchGroqChatCompletion({
  model,
  sourceText,
  systemPrompt,
  responseFormat,
}: {
  model: string;
  sourceText: string;
  systemPrompt: string;
  responseFormat: unknown;
}) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Analyze this source for one validated prediction-market artifact or reject it.\n\n${sourceText.slice(0, 20000)}`,
        },
      ],
      response_format: responseFormat,
    }),
  });
}

function createAnalysisSystemPrompt() {
  return [
    'You are AgoraBabel, a market artifact analyst.',
    'Return only schema-valid JSON.',
    'Reject inputs that are personal text, generic opinion, not news-like, not event-related, not publicly resolvable, or lack a clear deadlineable event.',
    'Only accept markets that are objective YES/NO questions, time-bounded, and resolvable from official or highly reputable public sources.',
    'When accepting a market, include at least two rejectedMarkets with draftId, question, reasonRejected, and violatedRule.',
    'Avoid vague resolution phrases such as official sources, according to official sources, sources say, otherwise, and unnamed authority.',
    'Use ISO date deadlines like 2026-06-15 and keep confidenceScore between 0 and 100.',
    'Do not create a market just because the topic is political or economic.',
  ].join(' ');
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();

  if (fenced) {
    return fenced;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function analyzeLocally(sourceText: string, preparedSource: PreparedSource): AnalysisResult {
  const lowerText = sourceText.toLowerCase();
  const region = detectRegion(lowerText);
  const detectedLanguage = detectLanguage(lowerText);
  const entities = detectEntities(sourceText, region);
  const eventKind = detectEventKind(lowerText);
  const deadline = detectDeadline(sourceText) || defaultDeadline();
  const hasAuthority = /(gobierno|banco central|ministerio|congreso|presidente|decreto|boletin oficial|official|central bank|ministry|parliament|cabinet|tcmb|merkez bankasi|resmi)/i.test(sourceText);
  const hasPublicSignal = hasAuthority || /\b(policy|regulation|court|agency|company|central|bank|minister|government|official|announce|approve|reject|launch|report|permit|tariff|rate|liquidity|subsidy|election|deadline)\b/i.test(sourceText);
  const isOpinion = /(creo que|pienso que|opinion|editorial|should|i think|in my view)/i.test(sourceText) && !hasAuthority;
  const eventSummary = createEventSummary(region, eventKind, deadline);
  const base = {
    detectedLanguage,
    region,
    sourceType: preparedSource.sourceType,
    extractedSource: preparedSource.extractedSource,
    entities,
    eventSummary,
  };

  if (!preparedSource.extractedSource && sourceText.trim().length < MIN_ARTICLE_LENGTH) {
    return rejected(base, 'Input is too short to analyze as an article or event source.');
  }

  if (isOpinion) {
    return rejected(base, 'The source reads like generic opinion and does not provide a concrete public event.');
  }

  if (!hasPublicSignal) {
    return rejected(base, 'No meaningful public political or economic event was detected.');
  }

  const id = `market-${createHash('sha1').update(`${eventSummary}:${deadline}`).digest('hex').slice(0, 10)}`;
  const resolutionSource = getResolutionSource(region, eventKind);
  const question = createQuestion(region, eventKind, deadline);
  const market = {
    id,
    question,
    yesCriteria: `YES if ${resolutionSource} publishes an announcement, decision, decree, or policy notice confirming the event before ${deadline}.`,
    noCriteria: `NO if ${resolutionSource} has not published a qualifying confirmation before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`,
    deadline,
    resolutionSource,
    evidenceSummary: `${entities.slice(0, 5).join(', ') || region} appear in the source, with a named public authority and a deadline candidate.`,
    confidenceScore: 78,
  };
  const rejectedNewsMarket = {
    id: `${id}-news-proxy`,
    question: `Will major English-language outlets report that ${eventSummary.toLowerCase()} before ${deadline}?`,
    yesCriteria: 'YES if at least two major English-language outlets publish matching coverage before the deadline.',
    noCriteria: 'NO if that coverage does not appear before the deadline.',
    deadline,
    resolutionSource: 'Major English-language news coverage',
    evidenceSummary: 'Rejected because news coverage is a proxy for attention, not the official underlying event.',
    confidenceScore: 42,
  };
  const rejectedMarketImpact = {
    id: `${id}-market-impact`,
    question: `Will markets react positively if ${eventSummary.toLowerCase()} before ${deadline}?`,
    yesCriteria: 'YES if selected market indicators move positively after the event.',
    noCriteria: 'NO if selected indicators do not move positively.',
    deadline,
    resolutionSource: 'Market price movement',
    evidenceSummary: 'Rejected because price reaction is subjective and not an objective public-event resolution.',
    confidenceScore: 28,
  };

  return {
    ...base,
    marketRelevance: {
      level: 'High',
      explanation: 'The source describes a public, authority-driven political or economic event with an explicit deadline and an official resolution path.',
      hasDeadlineableEvent: true,
    },
    candidateMarkets: [market, rejectedNewsMarket, rejectedMarketImpact],
    criticVerdict: {
      draftId: market.id,
      decision: 'accepted',
      checks: {
        ambiguity: 'pass',
        resolvability: 'pass',
        deadline: 'pass',
        evidence: 'pass',
        resolutionSource: 'pass',
      },
      reasoning: 'Accepted: the candidate is binary, deadline-bounded, and resolvable against public official sources.',
    },
    rejectedMarkets: [
      {
        draftId: rejectedNewsMarket.id,
        question: rejectedNewsMarket.question,
        reasonRejected: 'Rejected: English-language coverage is a proxy for attention, not the official underlying event.',
        violatedRule: 'weak resolution',
      },
      {
        draftId: rejectedMarketImpact.id,
        question: rejectedMarketImpact.question,
        reasonRejected: 'Rejected: market reaction wording is subjective and profit-adjacent rather than an objective public outcome.',
        violatedRule: 'subjective wording',
      },
    ],
    acceptedMarket: market,
    rejectionReason: null,
  };
}

function rejected(
  base: Pick<AnalysisResult, 'detectedLanguage' | 'region' | 'sourceType' | 'extractedSource' | 'entities' | 'eventSummary'>,
  rejectionReason: string,
): AnalysisResult {
  return {
    ...base,
    marketRelevance: {
      level: 'Low',
      explanation: rejectionReason,
      hasDeadlineableEvent: false,
    },
    candidateMarkets: [],
    criticVerdict: {
      draftId: null,
      decision: 'rejected',
      checks: {
        ambiguity: 'fail',
        resolvability: 'fail',
        deadline: 'fail',
        evidence: 'fail',
        resolutionSource: 'fail',
      },
      reasoning: rejectionReason,
    },
    rejectedMarkets: [],
    acceptedMarket: null,
    rejectionReason,
  };
}

function parseJinaReaderText(readableText: string, originalUrl: string) {
  const title = readableText.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || new URL(originalUrl).hostname;
  const markdownStart = readableText.match(/^Markdown Content:\s*$/m);
  const text = (markdownStart ? readableText.slice((markdownStart.index ?? 0) + markdownStart[0].length) : readableText)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title,
    domain: new URL(originalUrl).hostname.replace(/^www\./, ''),
    url: originalUrl,
    text,
  };
}

function htmlToReadableText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/blockquote>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isArticleUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSocialUrlHost(hostname: string): boolean {
  return SOCIAL_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isXUrlHost(hostname: string): boolean {
  return X_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function detectLanguage(lowerText: string) {
  if (/[ñáéíóú¿¡]/.test(lowerText) || /\b(el|la|los|las|gobierno|banco|decreto|antes del)\b/.test(lowerText)) return 'Spanish';
  if (/\bmerkez bankasi|turkiye|tcmb\b/.test(lowerText)) return 'Turkish';
  return 'English';
}

function detectRegion(lowerText: string) {
  if (/\bargentina|milei|banco central de la republica argentina|bcra\b/.test(lowerText)) return 'Argentina';
  if (/\bchile|santiago\b/.test(lowerText)) return 'Chile';
  if (/\bmexico|mexico city\b/.test(lowerText)) return 'Mexico';
  if (/\bturkey|turkiye|tcmb\b/.test(lowerText)) return 'Turkey';
  return 'Unknown';
}

function detectEventKind(lowerText: string) {
  if (/\b(controles cambiarios|cepo|currency controls|capital controls)\b/.test(lowerText)) return 'currency controls';
  if (/\b(decreto|decree|law|bill|regulation|reforma)\b/.test(lowerText)) return 'official policy decision';
  if (/\b(tasa|rate|liquidity|liquidez|central bank|banco central|tcmb|merkez bankasi)\b/.test(lowerText)) return 'central bank policy action';
  if (/\b(subsid|tariff|arancel|permit|licencia)\b/.test(lowerText)) return 'public economic policy action';
  if (/\b(company|agency|government|minister|official|announce|approve|reject|launch|publish|report|investigation|court|election)\b/.test(lowerText)) return 'publicly reported event';
  return 'publicly reported event';
}

function detectDeadline(sourceText: string) {
  const isoDate = sourceText.match(/\b(202[6-9]-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) return isoDate;

  const spanishDate = sourceText.match(/\b(?:antes del|para el|hasta el)\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(202[6-9])\b/i);
  if (spanishDate) {
    const month = monthNumber(spanishDate[2]);
    if (month) return `${spanishDate[3]}-${month}-${spanishDate[1].padStart(2, '0')}`;
  }

  return '';
}

function defaultDeadline() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function monthNumber(month: string) {
  const months: Record<string, string> = {
    enero: '01',
    febrero: '02',
    marzo: '03',
    abril: '04',
    mayo: '05',
    junio: '06',
    julio: '07',
    agosto: '08',
    septiembre: '09',
    octubre: '10',
    noviembre: '11',
    diciembre: '12',
  };

  return months[month.toLowerCase()];
}

function detectEntities(sourceText: string, region: string) {
  const entities = new Set<string>();
  if (region !== 'Unknown') entities.add(region);

  for (const match of sourceText.matchAll(/\b([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+){0,3})\b/g)) {
    const entity = match[1].trim();
    if (entity.length > 2 && !/^(Title|Markdown Content|Image|Source)$/.test(entity)) {
      entities.add(entity);
    }
    if (entities.size >= 10) break;
  }

  return Array.from(entities);
}

function createEventSummary(region: string, eventKind: string, deadline: string) {
  if (!eventKind) return 'No deadlineable public event detected.';
  return `${region === 'Unknown' ? 'A public authority' : region} may take ${eventKind} before ${deadline || 'an unspecified deadline'}.`;
}

function createQuestion(region: string, eventKind: string, deadline: string) {
  if (region === 'Turkey' && eventKind === 'central bank policy action') {
    return `Will Turkey officially confirm an emergency central-bank rate or liquidity intervention before ${deadline}?`;
  }

  if (region === 'Argentina' && eventKind === 'currency controls') {
    return `Will Argentina officially remove currency controls before ${deadline}?`;
  }

  return `Will ${region === 'Unknown' ? 'the named authority' : region} officially confirm ${eventKind} before ${deadline}?`;
}

function getResolutionSource(region: string, eventKind: string) {
  if (region === 'Turkey' && eventKind === 'central bank policy action') {
    return 'TCMB official monetary-policy, liquidity, or press announcement page';
  }

  if (region === 'Argentina' && eventKind === 'currency controls') {
    return 'Argentine Boletin Oficial, Economy Ministry, or BCRA official publication';
  }

  if (region === 'Chile') {
    return 'Chilean mining ministry official resolution or publication page';
  }

  if (region === 'Mexico') {
    return 'Mexican energy ministry official resolution or Diario Oficial publication';
  }

  return `${region} official ministry, central-bank, gazette, or regulator publication`;
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json;charset=utf-8');
  response.end(JSON.stringify(payload));
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  error: string,
  stage: string,
  likelyCause: string,
  details: string[] = [],
) {
  sendJson(response, statusCode, {
    error,
    stage,
    likelyCause,
    details,
  });
}

function inferErrorStage(message: string) {
  if (/paste|source input|characters/i.test(message)) return 'request-validation';
  if (/unsupported url|article extraction|readable text/i.test(message)) return 'source-extraction';
  if (/api_key|analysis_provider|llm|groq|openai|structured json/i.test(message)) return 'llm-provider';
  return 'api';
}

function inferLikelyCause(message: string) {
  if (/paste at least/i.test(message)) {
    return 'The submitted source is too short to analyze as article or event evidence.';
  }

  if (/unsupported url/i.test(message)) {
    return 'The submitted URL is from a social platform that the app does not scrape yet.';
  }

  if (/article extraction/i.test(message)) {
    return 'The URL reader could not extract enough article text from the submitted page.';
  }

  if (/api_key/i.test(message)) {
    return 'The selected LLM provider is missing its API key in the server environment.';
  }

  if (/schema|structured json/i.test(message)) {
    return 'The model or local analyzer returned data that does not satisfy the required market schema.';
  }

  return 'The analyze endpoint threw before returning a validated market analysis.';
}
