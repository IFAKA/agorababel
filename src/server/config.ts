import { GatewayClient } from '@circle-fin/x402-batching/client';

export type ServiceStatus = {
  status: 'configured' | 'unconfigured' | 'reachable' | 'unreachable';
  details: string;
};

export type RuntimeStatus = {
  status: 'ready' | 'not-ready';
  provider: 'groq' | 'openai';
  model: string;
  runtime: 'remote-llm';
  usesLlm: true;
  checkedAt: string;
  stagePacing: boolean;
  services: {
    llm: ServiceStatus;
    arcRpc: ServiceStatus;
    traceRegistry: ServiceStatus;
    circleWallet: ServiceStatus;
    x402: ServiceStatus;
  };
  missing: string[];
};

export function getRuntimeConfig() {
  const provider = (process.env.ANALYSIS_PROVIDER ?? 'groq').toLowerCase();

  if (provider !== 'groq' && provider !== 'openai') {
    throw new Error('ANALYSIS_PROVIDER must be groq or openai. Local and auto fallback providers are disabled.');
  }

  return {
    provider,
    model: provider === 'groq'
      ? process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b'
      : process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    arcRpcUrl: process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.network',
    arcChainId: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
    traceRegistryAddress: process.env.ARC_TRACE_REGISTRY_ADDRESS ?? '',
    committerPrivateKey: process.env.ARC_COMMITTER_PRIVATE_KEY ?? '',
    circleApiKey: process.env.CIRCLE_API_KEY ?? '',
    circleEntitySecret: process.env.CIRCLE_ENTITY_SECRET ?? '',
    circleWalletSetId: process.env.CIRCLE_WALLET_SET_ID ?? '',
    circleAgentWalletId: process.env.CIRCLE_AGENT_WALLET_ID ?? '',
    circleAgentWalletAddress: process.env.CIRCLE_AGENT_WALLET_ADDRESS ?? '',
    x402Enabled: (process.env.X402_ENABLED ?? 'false').toLowerCase() === 'true',
    x402PriceUsdcMicro: Number(process.env.X402_PRICE_USDC_MICRO ?? '0'),
    x402PayToAddress: process.env.X402_PAY_TO_ADDRESS ?? '',
    x402FacilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com',
    x402BuyerPrivateKey: process.env.X402_BUYER_PRIVATE_KEY || process.env.ARC_COMMITTER_PRIVATE_KEY || '',
  } as const;
}

export function getMissingProductionConfig() {
  const config = getRuntimeConfig();
  const missing: string[] = [];

  if (config.provider === 'groq' && !process.env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
  if (config.provider === 'openai' && !process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (config.arcChainId !== 5042002) missing.push('ARC_CHAIN_ID=5042002');
  if (!config.arcRpcUrl) missing.push('ARC_TESTNET_RPC_URL');
  if (!config.traceRegistryAddress) missing.push('ARC_TRACE_REGISTRY_ADDRESS');
  if (!config.committerPrivateKey) missing.push('ARC_COMMITTER_PRIVATE_KEY');
  if (!config.circleApiKey) missing.push('CIRCLE_API_KEY');
  if (!config.circleEntitySecret) missing.push('CIRCLE_ENTITY_SECRET');
  if (!config.circleWalletSetId) missing.push('CIRCLE_WALLET_SET_ID');
  if (!config.circleAgentWalletId) missing.push('CIRCLE_AGENT_WALLET_ID');
  if (!config.circleAgentWalletAddress) missing.push('CIRCLE_AGENT_WALLET_ADDRESS');
  if (config.x402Enabled) {
    if (!config.x402PriceUsdcMicro || config.x402PriceUsdcMicro <= 0) missing.push('X402_PRICE_USDC_MICRO');
    if (!config.x402PayToAddress) missing.push('X402_PAY_TO_ADDRESS');
    if (!config.x402BuyerPrivateKey) missing.push('X402_BUYER_PRIVATE_KEY or ARC_COMMITTER_PRIVATE_KEY');
  }

  return missing;
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const config = getRuntimeConfig();
  const missing = getMissingProductionConfig();
  const arcReachable = await checkArcRpc(config.arcRpcUrl);
  const llmConfigured = config.provider === 'groq' ? Boolean(process.env.GROQ_API_KEY) : Boolean(process.env.OPENAI_API_KEY);
  const x402Buyer = await checkX402BuyerPaymentReadiness(config);

  if (!arcReachable) missing.push('ARC_TESTNET_RPC_URL reachable RPC');
  if (config.x402Enabled && !x402Buyer.ready) missing.push(x402Buyer.missing);

  return {
    status: missing.length === 0 ? 'ready' : 'not-ready',
    provider: config.provider,
    model: config.model,
    runtime: 'remote-llm',
    usesLlm: true,
    checkedAt: new Date().toISOString(),
    stagePacing: process.env.VITE_DEMO_PACING === 'true',
    services: {
      llm: {
        status: llmConfigured ? 'configured' : 'unconfigured',
        details: config.provider === 'groq' ? 'Groq Chat Completions' : 'OpenAI Responses',
      },
      arcRpc: {
        status: arcReachable ? 'reachable' : 'unreachable',
        details: config.arcRpcUrl,
      },
      traceRegistry: {
        status: config.traceRegistryAddress ? 'configured' : 'unconfigured',
        details: config.traceRegistryAddress || 'ARC_TRACE_REGISTRY_ADDRESS missing',
      },
      circleWallet: {
        status: config.circleApiKey && config.circleEntitySecret && config.circleWalletSetId && config.circleAgentWalletId && config.circleAgentWalletAddress ? 'configured' : 'unconfigured',
        details: config.circleAgentWalletAddress || 'Circle ARC-TESTNET wallet config missing',
      },
      x402: {
        status: config.x402Enabled && config.x402PayToAddress && config.x402PriceUsdcMicro > 0 && config.x402BuyerPrivateKey
          ? x402Buyer.ready ? 'reachable' : 'unreachable'
          : 'unconfigured',
        details: config.x402Enabled
          ? x402Buyer.details
          : 'X402_ENABLED=false',
      },
    },
    missing: [...new Set(missing)],
  };
}

async function checkArcRpc(rpcUrl: string) {
  if (!rpcUrl) return false;

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });

    if (!response.ok) return false;
    const payload = await response.json() as { result?: string };
    return Number.parseInt(payload.result ?? '0x0', 16) === 5042002;
  } catch {
    return false;
  }
}

async function checkX402BuyerPaymentReadiness(config: ReturnType<typeof getRuntimeConfig>) {
  if (!config.x402Enabled) {
    return {
      ready: true,
      missing: '',
      details: 'X402_ENABLED=false',
    };
  }

  if (!config.x402BuyerPrivateKey || !config.x402PriceUsdcMicro || config.x402PriceUsdcMicro <= 0) {
    return {
      ready: false,
      missing: 'X402_BUYER_PRIVATE_KEY with positive X402_PRICE_USDC_MICRO',
      details: 'x402 buyer payment config is incomplete.',
    };
  }

  try {
    const buyer = new GatewayClient({
      chain: 'arcTestnet',
      privateKey: normalizePrivateKey(config.x402BuyerPrivateKey),
      rpcUrl: config.arcRpcUrl,
    });
    const balances = await buyer.getBalances();
    const requiredAmount = BigInt(config.x402PriceUsdcMicro);
    const gatewayAvailable = toBigIntBalance((balances as { gateway?: { available?: unknown } }).gateway?.available);
    const walletAvailable = toBigIntBalance((balances as { wallet?: { available?: unknown; balance?: unknown } }).wallet?.available)
      ?? toBigIntBalance((balances as { wallet?: { balance?: unknown } }).wallet?.balance)
      ?? 0n;
    const totalPayable = gatewayAvailable + walletAvailable;

    if (totalPayable >= requiredAmount) {
      return {
        ready: true,
        missing: '',
        details: `Buyer ${buyer.address} can cover ${formatUsdcMicro(requiredAmount)} USDC through Gateway or wallet balance.`,
      };
    }

    return {
      ready: false,
      missing: `X402 buyer ${buyer.address} needs at least ${formatUsdcMicro(requiredAmount)} USDC; available ${formatUsdcMicro(totalPayable)} USDC`,
      details: `Buyer ${buyer.address} has ${formatUsdcMicro(gatewayAvailable)} USDC in Gateway and ${formatUsdcMicro(walletAvailable)} USDC in wallet; needs ${formatUsdcMicro(requiredAmount)} USDC.`,
    };
  } catch (error) {
    return {
      ready: false,
      missing: 'X402 buyer balance check reachable',
      details: error instanceof Error ? error.message : 'x402 buyer balance check failed.',
    };
  }
}

function normalizePrivateKey(value: string) {
  return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
}

function toBigIntBalance(value: unknown) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function formatUsdcMicro(value: bigint | number) {
  const atomic = typeof value === 'bigint' ? value : BigInt(value);
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
