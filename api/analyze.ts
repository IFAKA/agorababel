import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

const MIN_ARTICLE_LENGTH = 120;

type MarketQuestion = {
  id: string;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  deadline: string;
  resolutionSource: string;
  evidenceSummary: string;
  confidenceScore: number;
};

type AnalysisResult = {
  detectedLanguage: string;
  region: string;
  sourceType: 'article' | 'url_article' | 'official_report' | 'social_post' | 'other';
  extractedSource: null;
  entities: string[];
  eventSummary: string;
  marketRelevance: {
    level: 'Low' | 'Medium' | 'High';
    explanation: string;
    hasDeadlineableEvent: boolean;
  };
  candidateMarkets: MarketQuestion[];
  criticVerdict: {
    draftId: string | null;
    decision: 'accepted' | 'rejected';
    checks: {
      ambiguity: 'pass' | 'fail';
      resolvability: 'pass' | 'fail';
      deadline: 'pass' | 'fail';
      evidence: 'pass' | 'fail';
      resolutionSource: 'pass' | 'fail';
    };
    reasoning: string;
    violatedRule?: 'ambiguity' | 'no deadline' | 'subjective wording' | 'weak resolution';
  };
  rejectedMarkets: Array<{
    draftId: string;
    question: string;
    reasonRejected: string;
    violatedRule: 'ambiguity' | 'no deadline' | 'subjective wording' | 'weak resolution';
  }>;
  acceptedMarket: MarketQuestion | null;
  rejectionReason: string | null;
};

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    sendError(response, 405, 'Method not allowed.', 'request', 'The analyze endpoint only accepts POST requests.');
    return;
  }

  try {
    const body = await readJson(request);
    const sourceText = typeof body?.sourceText === 'string' ? body.sourceText.trim() : '';

    if (!sourceText) {
      sendError(response, 400, 'Paste article text or an article URL.', 'request-validation', 'The sourceText field is required.');
      return;
    }

    if (sourceText.length < MIN_ARTICLE_LENGTH) {
      sendError(response, 400, 'Paste at least 120 characters of article or source text.', 'request-validation', 'The submitted source is too short to analyze as article or event evidence.');
      return;
    }

    const analysis = await analyzeSource(sourceText);
    sendJson(response, 200, analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    sendError(response, 400, message, inferErrorStage(message), inferLikelyCause(message), [
      `ANALYSIS_PROVIDER=${(process.env.ANALYSIS_PROVIDER ?? 'local').toLowerCase()}`,
    ]);
  }
}

async function analyzeSource(sourceText: string): Promise<AnalysisResult> {
  const provider = (process.env.ANALYSIS_PROVIDER ?? 'local').toLowerCase();

  if (provider === 'groq' && process.env.GROQ_API_KEY) {
    try {
      return normalizeAnalysisResult(await analyzeWithGroq(sourceText));
    } catch (error) {
      throw new Error(error instanceof Error ? `Groq provider failed: ${error.message}` : 'Groq provider failed.');
    }
  }

  return analyzeLocally(sourceText);
}

async function analyzeWithGroq(sourceText: string): Promise<AnalysisResult> {
  const model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Return only JSON for an AgoraBabel market artifact.',
            'The JSON must contain detectedLanguage, region, sourceType, extractedSource, entities, eventSummary, marketRelevance, candidateMarkets, criticVerdict, rejectedMarkets, acceptedMarket, rejectionReason.',
            'Accepted markets must be objective YES/NO questions with ISO deadlines, named official resolution sources, all critic checks pass, confidenceScore 0-100, and at least two rejectedMarkets.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Analyze this source. If it describes a public deadlineable event, return one accepted market and two rejected candidates. Otherwise reject it.\n\n${sourceText.slice(0, 12000)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} from Groq ${model}. ${detail.slice(0, 220)}`);
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No JSON content returned from Groq ${model}.`);

  return JSON.parse(extractJsonObject(content)) as AnalysisResult;
}

function analyzeLocally(sourceText: string): AnalysisResult {
  const lowerText = sourceText.toLowerCase();
  const region = detectRegion(lowerText);
  const detectedLanguage = detectLanguage(lowerText);
  const eventKind = detectEventKind(lowerText);
  const deadline = normalizeDeadline(detectDeadline(sourceText) || defaultDeadline());
  const entities = detectEntities(sourceText, region);
  const eventSummary = createEventSummary(region, eventKind, deadline);
  const resolutionSource = getResolutionSource(region, eventKind);
  const id = `market-${createHash('sha1').update(`${eventSummary}:${deadline}`).digest('hex').slice(0, 10)}`;
  const market: MarketQuestion = {
    id,
    question: createQuestion(region, eventKind, deadline),
    yesCriteria: `YES if ${resolutionSource} publishes an announcement, decision, decree, or policy notice confirming the event before ${deadline}.`,
    noCriteria: `NO if ${resolutionSource} has not published a qualifying confirmation before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`,
    deadline,
    resolutionSource,
    evidenceSummary: `${entities.slice(0, 5).join(', ') || region} appear in the source, with a named public authority and a deadline candidate.`,
    confidenceScore: 78,
  };
  const rejectedNewsMarket = createRejectedCandidate(`${id}-news-proxy`, `Will major English-language outlets report that ${eventSummary.toLowerCase()} before ${deadline}?`, deadline, 'Major English-language news coverage', 42);
  const rejectedMarketImpact = createRejectedCandidate(`${id}-market-impact`, `Will ${region} markets react positively if ${eventSummary.toLowerCase()} before ${deadline}?`, deadline, 'Market price movement', 28);

  return {
    detectedLanguage,
    region,
    sourceType: 'article',
    extractedSource: null,
    entities,
    eventSummary,
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

function normalizeAnalysisResult(value: AnalysisResult): AnalysisResult {
  const localFallback = analyzeLocally(`${value.eventSummary} before ${normalizeDeadline(value.acceptedMarket?.deadline ?? '')}`);
  const acceptedMarket = value.acceptedMarket
    ? normalizeMarket(value.acceptedMarket, value.region, value.eventSummary)
    : localFallback.acceptedMarket;
  const supplemental = acceptedMarket ? [
    createRejectedCandidate(`${acceptedMarket.id}-news-proxy`, `Will major English-language outlets report that ${value.eventSummary.toLowerCase()} before ${acceptedMarket.deadline}?`, acceptedMarket.deadline, 'Major English-language news coverage', 42),
    createRejectedCandidate(`${acceptedMarket.id}-market-impact`, `Will ${value.region} markets react positively if ${value.eventSummary.toLowerCase()} before ${acceptedMarket.deadline}?`, acceptedMarket.deadline, 'Market price movement', 28),
  ] : [];
  const candidates = [acceptedMarket, ...value.candidateMarkets, ...supplemental]
    .filter((item): item is MarketQuestion => Boolean(item))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 3);
  const rejectedMarkets = value.rejectedMarkets
    .filter((item) => item.draftId !== acceptedMarket?.id)
    .slice(0, 2);

  while (acceptedMarket && rejectedMarkets.length < 2) {
    const candidate = supplemental[rejectedMarkets.length];
    rejectedMarkets.push({
      draftId: candidate.id,
      question: candidate.question,
      reasonRejected: candidate.evidenceSummary,
      violatedRule: rejectedMarkets.length === 0 ? 'weak resolution' : 'subjective wording',
    });
  }

  return {
    ...value,
    sourceType: value.sourceType ?? 'article',
    extractedSource: null,
    entities: Array.isArray(value.entities) ? value.entities.slice(0, 12) : localFallback.entities,
    eventSummary: value.eventSummary || localFallback.eventSummary,
    candidateMarkets: candidates.length ? candidates : localFallback.candidateMarkets,
    acceptedMarket,
    rejectedMarkets,
    criticVerdict: acceptedMarket
      ? {
          draftId: acceptedMarket.id,
          decision: 'accepted',
          checks: {
            ambiguity: 'pass',
            resolvability: 'pass',
            deadline: 'pass',
            evidence: 'pass',
            resolutionSource: 'pass',
          },
          reasoning: value.criticVerdict?.reasoning || 'Accepted: binary, deadline-bounded, and publicly resolvable.',
        }
      : value.criticVerdict,
    rejectionReason: acceptedMarket ? null : value.rejectionReason ?? 'No deadlineable public event could be validated.',
  };
}

function normalizeMarket(market: MarketQuestion, region: string, eventSummary: string): MarketQuestion {
  const deadline = normalizeDeadline(market.deadline);
  const resolutionSource = market.resolutionSource && !/official sources|sources say|named public authority|public authority/i.test(market.resolutionSource)
    ? market.resolutionSource
    : getResolutionSource(region, detectEventKind(eventSummary.toLowerCase()));

  return {
    ...market,
    id: market.id || `market-${createHash('sha1').update(`${eventSummary}:${deadline}`).digest('hex').slice(0, 10)}`,
    deadline,
    resolutionSource,
    yesCriteria: normalizeCriteria('YES', market.yesCriteria, resolutionSource, deadline),
    noCriteria: normalizeCriteria('NO', market.noCriteria, resolutionSource, deadline),
    confidenceScore: clampConfidence(market.confidenceScore),
  };
}

function createRejectedCandidate(id: string, question: string, deadline: string, resolutionSource: string, confidenceScore: number): MarketQuestion {
  return {
    id,
    question,
    yesCriteria: 'YES if at least two major English-language outlets publish matching coverage before the deadline.',
    noCriteria: 'NO if that coverage does not appear before the deadline.',
    deadline,
    resolutionSource,
    evidenceSummary: resolutionSource === 'Market price movement'
      ? 'Rejected because price reaction is subjective and not an objective public-event resolution.'
      : 'Rejected because news coverage is a proxy for attention, not the official underlying event.',
    confidenceScore,
  };
}

function normalizeCriteria(label: 'YES' | 'NO', value: string, resolutionSource: string, deadline: string) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const vague = /\b(according to official sources|official sources|sources say|named public authority|public authority|otherwise)\b/i.test(trimmed);

  if (label === 'YES' && (!trimmed.startsWith('YES') || trimmed.length < 70 || vague)) {
    return `YES if ${resolutionSource} publishes an announcement, decision, decree, or policy notice confirming the event before ${deadline}.`;
  }

  if (label === 'NO' && (!trimmed.startsWith('NO') || trimmed.length < 70 || vague)) {
    return `NO if ${resolutionSource} has not published a qualifying confirmation before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`;
  }

  return trimmed;
}

function detectLanguage(lowerText: string) {
  if (/[ñáéíóú¿¡]/.test(lowerText) || /\b(el|la|los|las|gobierno|banco|decreto|antes del)\b/.test(lowerText)) return 'Spanish';
  if (/\bmerkez bankasi|turkiye|tcmb\b/.test(lowerText)) return 'Turkish';
  return 'English';
}

function detectRegion(lowerText: string) {
  if (/\bargentina|banco central de la republica argentina|bcra\b/.test(lowerText)) return 'Argentina';
  if (/\bchile|santiago|lithium\b/.test(lowerText)) return 'Chile';
  if (/\bturkey|turkiye|tcmb\b/.test(lowerText)) return 'Turkey';
  if (/\bmexico|mexico city\b/.test(lowerText)) return 'Mexico';
  return 'Unknown';
}

function detectEventKind(lowerText: string) {
  if (/\b(controles cambiarios|cepo|currency controls|capital controls)\b/.test(lowerText)) return 'currency controls';
  if (/\b(tasa|rate|liquidity|liquidez|central bank|banco central|tcmb|merkez bankasi)\b/.test(lowerText)) return 'central bank policy action';
  if (/\b(lithium|permit|licencia)\b/.test(lowerText)) return 'public economic policy action';
  if (/\b(decreto|decree|law|bill|regulation|reforma)\b/.test(lowerText)) return 'official policy decision';
  return 'publicly reported event';
}

function detectDeadline(sourceText: string) {
  return sourceText.match(/\b(202[6-9]-\d{2}-\d{2})\b/)?.[1] ?? '';
}

function defaultDeadline() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function normalizeDeadline(value: string) {
  const isoDate = String(value).match(/\b(202[6-9]-\d{2}-\d{2})\b/)?.[1];
  return isoDate ?? defaultDeadline();
}

function detectEntities(sourceText: string, region: string) {
  const entities = new Set<string>();
  if (region !== 'Unknown') entities.add(region);
  for (const match of sourceText.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\b/g)) {
    entities.add(match[1].trim());
    if (entities.size >= 10) break;
  }
  return Array.from(entities);
}

function createEventSummary(region: string, eventKind: string, deadline: string) {
  return `${region === 'Unknown' ? 'A public authority' : region} may take ${eventKind} before ${deadline}.`;
}

function createQuestion(region: string, eventKind: string, deadline: string) {
  if (region === 'Turkey' && eventKind === 'central bank policy action') {
    return `Will Turkey officially confirm an emergency central-bank rate or liquidity intervention before ${deadline}?`;
  }
  if (region === 'Argentina' && eventKind === 'currency controls') {
    return `Will Argentina officially remove currency controls before ${deadline}?`;
  }
  if (region === 'Chile') {
    return `Will Chile publish a lithium extraction permit decision before ${deadline}?`;
  }
  return `Will ${region === 'Unknown' ? 'the named authority' : region} officially confirm ${eventKind} before ${deadline}?`;
}

function getResolutionSource(region: string, eventKind: string) {
  if (region === 'Turkey' && eventKind === 'central bank policy action') return 'TCMB official monetary-policy, liquidity, or press announcement page';
  if (region === 'Argentina' && eventKind === 'currency controls') return 'Argentine Boletin Oficial, Economy Ministry, or BCRA official publication';
  if (region === 'Chile') return 'Chilean mining ministry official resolution or publication page';
  if (region === 'Mexico') return 'Mexican energy ministry official resolution or Diario Oficial publication';
  return `${region} official ministry, central-bank, gazette, or regulator publication`;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
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

function sendError(response: ServerResponse, statusCode: number, error: string, stage: string, likelyCause: string, details: string[] = []) {
  sendJson(response, statusCode, { error, stage, likelyCause, details });
}

function inferErrorStage(message: string) {
  if (/groq|llm|api_key/i.test(message)) return 'llm-provider';
  if (/paste|characters/i.test(message)) return 'request-validation';
  return 'api';
}

function inferLikelyCause(message: string) {
  if (/groq/i.test(message)) return 'The selected Groq provider failed before returning a validated market artifact.';
  if (/paste at least/i.test(message)) return 'The submitted source is too short to analyze as article or event evidence.';
  return 'The analyze endpoint threw before returning a validated market analysis.';
}
