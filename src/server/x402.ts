import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AnalysisResult, X402PublicationStatus } from '../app/pipeline/analysisSchema';
import { getRuntimeConfig } from './config';
import { methodNotAllowed, sendError, sendJson } from './http';

const artifactStore = new Map<string, AnalysisResult>();

export function publishX402Artifact(artifact: AnalysisResult): X402PublicationStatus {
  const config = getRuntimeConfig();
  const artifactId = artifact.acceptedMarket?.id ?? artifact.runId;
  artifactStore.set(artifactId, artifact);

  return {
    status: config.x402Enabled ? 'required' : 'disabled',
    artifactId,
    priceUsdcMicro: config.x402Enabled ? config.x402PriceUsdcMicro : null,
    payToAddress: config.x402Enabled ? config.x402PayToAddress : null,
    facilitatorUrl: config.x402Enabled ? config.x402FacilitatorUrl : null,
    intelligenceUrl: `/api/markets/${encodeURIComponent(artifactId)}/intelligence`,
  };
}

export async function handleMarketIntelligenceRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET') {
    methodNotAllowed(request, response, 'x402-intelligence', 'GET');
    return;
  }

  const config = getRuntimeConfig();
  if (!config.x402Enabled) {
    sendError(response, 503, 'x402 is disabled for this deployment.', 'x402-publication', 'X402_ENABLED=false; paid artifact access is not available.');
    return;
  }

  const artifactId = decodeURIComponent((request.url ?? '').match(/\/api\/markets\/([^/]+)\/intelligence/)?.[1] ?? '');
  const artifact = artifactStore.get(artifactId);

  if (!artifact) {
    sendError(response, 404, 'Artifact not found.', 'x402-publication', 'The requested artifact is not present in the server artifact store.');
    return;
  }

  const paymentHeader = request.headers['x-payment'];
  if (!paymentHeader || Array.isArray(paymentHeader)) {
    response.statusCode = 402;
    response.setHeader('Content-Type', 'application/json;charset=utf-8');
    response.setHeader('X-402-Price-USDC-Micro', String(config.x402PriceUsdcMicro));
    response.setHeader('X-402-Pay-To', config.x402PayToAddress);
    response.setHeader('X-402-Network', 'ARC-TESTNET');
    response.end(JSON.stringify({
      error: 'Payment Required',
      stage: 'x402-publication',
      priceUsdcMicro: config.x402PriceUsdcMicro,
      payToAddress: config.x402PayToAddress,
      network: 'ARC-TESTNET',
      facilitatorUrl: config.x402FacilitatorUrl,
    }));
    return;
  }

  const verified = await verifyPayment(paymentHeader);
  if (!verified) {
    sendError(response, 402, 'x402 payment verification failed.', 'x402-publication', 'The X-PAYMENT proof was rejected by the configured facilitator.');
    return;
  }

  sendJson(response, 200, artifact);
}

async function verifyPayment(paymentHeader: string) {
  const config = getRuntimeConfig();
  const response = await fetch(config.x402FacilitatorUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      payment: paymentHeader,
      priceUsdcMicro: config.x402PriceUsdcMicro,
      payToAddress: config.x402PayToAddress,
      network: 'ARC-TESTNET',
    }),
  });

  if (!response.ok) return false;
  const payload = await response.json().catch(() => null) as { valid?: boolean; success?: boolean } | null;
  return payload?.valid === true || payload?.success === true;
}
