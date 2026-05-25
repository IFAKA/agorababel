import type { IncomingMessage, ServerResponse } from 'node:http';
import { GatewayClient } from '@circle-fin/x402-batching/client';
import { createGatewayMiddleware, type PaymentRequest } from '@circle-fin/x402-batching/server';
import type { AnalysisResult, X402PublicationStatus } from '../app/pipeline/analysisSchema.ts';
import { getRuntimeConfig } from './config.ts';
import { methodNotAllowed, sendError, sendJson } from './http.ts';

const artifactStore = new Map<string, AnalysisResult>();
const arcTestnetNetwork = 'eip155:5042002';
const arcTestnetGatewayChain = 'arcTestnet';
const gatewayDescription = 'AgoraBabel paid market intelligence artifact';

type PaidIntelligencePayload = AnalysisResult & {
  x402Receipt?: X402Receipt;
};

type X402Receipt = {
  payer: string;
  seller: string;
  priceUsdcMicro: number;
  formattedPrice: string;
  network: string;
  settlementTransaction: string | null;
};

type DemoUnlockResponse = {
  status: 'unlocked';
  artifactId: string;
  buyer: string;
  deposit: null | {
    status: 'submitted';
    amountUsdc: string;
    depositTxHash: string;
    approvalTxHash?: string;
  };
  receipt: X402Receipt;
  intelligence: PaidIntelligencePayload;
};

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
    gatewayUrl: config.x402Enabled ? config.x402FacilitatorUrl : null,
    network: config.x402Enabled ? 'Arc Testnet' : null,
    intelligenceUrl: `/api/markets/${encodeURIComponent(artifactId)}/intelligence`,
    demoUnlockUrl: config.x402Enabled ? `/api/markets/${encodeURIComponent(artifactId)}/demo-unlock` : null,
  };
}

export async function handleMarketIntelligenceRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.url?.includes('/demo-unlock')) {
    await handleDemoUnlockRequest(request, response);
    return;
  }

  if (!request.url?.includes('/intelligence')) {
    sendError(response, 404, 'Market API route not found.', 'x402-publication', 'Expected /api/markets/:id/intelligence or /api/markets/:id/demo-unlock.');
    return;
  }

  if (request.method !== 'GET') {
    methodNotAllowed(request, response, 'x402-intelligence', 'GET');
    return;
  }

  const config = getRuntimeConfig();
  if (!config.x402Enabled) {
    sendError(response, 503, 'x402 is disabled for this deployment.', 'x402-publication', 'X402_ENABLED=false; paid artifact access is not available.');
    return;
  }

  const artifactId = getArtifactId(request.url, 'intelligence');
  const artifact = artifactStore.get(artifactId);

  if (!artifact) {
    sendError(response, 404, 'Artifact not found.', 'x402-publication', 'The requested artifact is not present in the server artifact store.');
    return;
  }

  await requireGatewayPayment(request, response, artifactId, () => {
    sendJson(response, 200, {
      ...artifact,
      x402Receipt: createReceipt((request as PaymentRequest).payment),
    } satisfies PaidIntelligencePayload);
  });
}

async function handleDemoUnlockRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    methodNotAllowed(request, response, 'x402-demo-unlock', 'POST');
    return;
  }

  const config = getRuntimeConfig();
  if (!config.x402Enabled) {
    sendError(response, 503, 'x402 is disabled for this deployment.', 'x402-demo-unlock', 'X402_ENABLED=false; buyer-agent payment is unavailable.');
    return;
  }

  if (!config.x402BuyerPrivateKey) {
    sendError(response, 503, 'x402 buyer agent is not configured.', 'x402-demo-unlock', 'Set X402_BUYER_PRIVATE_KEY or ARC_COMMITTER_PRIVATE_KEY for the demo buyer agent.');
    return;
  }

  const artifactId = getArtifactId(request.url, 'demo-unlock');
  const artifact = artifactStore.get(artifactId);

  if (!artifact) {
    sendError(response, 404, 'Artifact not found.', 'x402-demo-unlock', 'The requested artifact is not present in the server artifact store.');
    return;
  }

  try {
    const buyer = new GatewayClient({
      chain: arcTestnetGatewayChain,
      privateKey: normalizePrivateKey(config.x402BuyerPrivateKey),
      rpcUrl: config.arcRpcUrl,
    });
    const price = BigInt(config.x402PriceUsdcMicro);
    const deposit = await depositIfNeeded(buyer, price);
    const paid = await buyer.pay<PaidIntelligencePayload>(createAbsoluteUrl(request, `/api/markets/${encodeURIComponent(artifactId)}/intelligence`));
    const receipt = paid.data.x402Receipt ?? {
      payer: buyer.address,
      seller: config.x402PayToAddress,
      priceUsdcMicro: Number(paid.amount || price),
      formattedPrice: paid.formattedAmount || formatUsdcMicro(price),
      network: 'Arc Testnet',
      settlementTransaction: paid.transaction || null,
    };

    sendJson(response, 200, {
      status: 'unlocked',
      artifactId,
      buyer: buyer.address,
      deposit,
      receipt,
      intelligence: {
        ...paid.data,
        x402Receipt: receipt,
      },
    } satisfies DemoUnlockResponse);
  } catch (error) {
    sendError(
      response,
      502,
      'Demo buyer-agent x402 unlock failed.',
      'x402-demo-unlock',
      error instanceof Error ? error.message : 'Circle Gateway buyer payment failed.',
    );
  }
}

async function requireGatewayPayment(request: IncomingMessage, response: ServerResponse, artifactId: string, next: () => void) {
  const config = getRuntimeConfig();
  const gateway = createGatewayMiddleware({
    sellerAddress: config.x402PayToAddress,
    networks: arcTestnetNetwork,
    facilitatorUrl: config.x402FacilitatorUrl,
    description: gatewayDescription,
  });
  const middleware = gateway.require(`$${formatUsdcMicro(config.x402PriceUsdcMicro)}`);

  response.setHeader('X-402-Price-USDC-Micro', String(config.x402PriceUsdcMicro));
  response.setHeader('X-402-Pay-To', config.x402PayToAddress);
  response.setHeader('X-402-Network', 'ARC-TESTNET');
  response.setHeader('X-402-Gateway', config.x402FacilitatorUrl);

  const originalEnd = response.end.bind(response);
  response.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
    if (response.statusCode === 402 && response.hasHeader('PAYMENT-REQUIRED')) {
      const body = JSON.stringify({
        error: 'Payment Required',
        stage: 'x402-publication',
        artifactId,
        priceUsdcMicro: config.x402PriceUsdcMicro,
        formattedPrice: formatUsdcMicro(config.x402PriceUsdcMicro),
        payToAddress: config.x402PayToAddress,
        network: 'ARC-TESTNET',
        gatewayUrl: config.x402FacilitatorUrl,
        paymentRequiredHeader: response.getHeader('PAYMENT-REQUIRED'),
      });

      response.setHeader('Content-Type', 'application/json;charset=utf-8');
      return originalEnd(body, typeof encoding === 'function' ? encoding : callback);
    }

    return originalEnd(chunk as never, encoding as never, callback);
  }) as ServerResponse['end'];

  await middleware(request as PaymentRequest, response, (error?: unknown) => {
    if (error) {
      throw error;
    }
    next();
  });
}

async function depositIfNeeded(client: GatewayClient, requiredAmount: bigint): Promise<DemoUnlockResponse['deposit']> {
  const balances = await client.getBalances();
  if (balances.gateway.available >= requiredAmount) return null;

  const deficit = requiredAmount - balances.gateway.available;
  const deposit = await client.deposit(formatUsdcMicro(deficit));

  return {
    status: 'submitted',
    amountUsdc: deposit.formattedAmount,
    depositTxHash: deposit.depositTxHash,
    approvalTxHash: deposit.approvalTxHash,
  };
}

function createReceipt(payment: PaymentRequest['payment'] | undefined): X402Receipt {
  const config = getRuntimeConfig();

  return {
    payer: payment?.payer ?? '',
    seller: config.x402PayToAddress,
    priceUsdcMicro: config.x402PriceUsdcMicro,
    formattedPrice: formatUsdcMicro(config.x402PriceUsdcMicro),
    network: payment?.network === arcTestnetNetwork ? 'Arc Testnet' : payment?.network ?? 'Arc Testnet',
    settlementTransaction: payment?.transaction ?? null,
  };
}

function getArtifactId(url: string | undefined, suffix: 'intelligence' | 'demo-unlock') {
  const match = (url ?? '').match(new RegExp(`(?:/api/markets)?/([^/]+)/${suffix}`));
  return decodeURIComponent(match?.[1] ?? '');
}

function createAbsoluteUrl(request: IncomingMessage, path: string) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = proto ?? 'http';
  const host = request.headers.host ?? '127.0.0.1:5173';
  return `${protocol}://${host}${path}`;
}

function normalizePrivateKey(value: string) {
  return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
}

function formatUsdcMicro(value: bigint | number) {
  const atomic = typeof value === 'bigint' ? value : BigInt(value);
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
