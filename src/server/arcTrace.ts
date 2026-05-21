import { createHash } from 'node:crypto';
import type { MarketQuestion } from '../app/pipeline/analysisSchema';
import { getRuntimeConfig } from './config';
import { traceRegistryAbi } from './traceRegistryAbi';

export type CommitTraceInput = {
  runId: string;
  sourceHash: string;
  acceptedMarket: MarketQuestion;
  artifact: unknown;
};

export async function commitArcTrace(input: CommitTraceInput) {
  const config = getRuntimeConfig();

  if (!config.traceRegistryAddress || !config.committerPrivateKey) {
    throw new Error('Arc trace commit failed: ARC_TRACE_REGISTRY_ADDRESS and ARC_COMMITTER_PRIVATE_KEY are required.');
  }

  const artifactHash = `0x${sha256Hex(canonicalJson(input.artifact))}` as `0x${string}`;
  const sourceHash = `0x${input.sourceHash}` as `0x${string}`;

  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  const account = accounts.privateKeyToAccount(config.committerPrivateKey as `0x${string}`);
  const client = viem.createWalletClient({
    account,
    chain: {
      id: 5042002,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: [config.arcRpcUrl] } },
    },
    transport: viem.http(config.arcRpcUrl),
  });
  const publicClient = viem.createPublicClient({
    chain: {
      id: 5042002,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: [config.arcRpcUrl] } },
    },
    transport: viem.http(config.arcRpcUrl),
  });
  const transactionHash = await client.writeContract({
    address: config.traceRegistryAddress as `0x${string}`,
    abi: traceRegistryAbi,
    functionName: 'commitTrace',
    args: [artifactHash, sourceHash, input.acceptedMarket.id],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });

  if (!receipt || receipt.status !== 'success') {
    throw new Error('Arc trace commit failed: transaction receipt was missing or reverted.');
  }

  return {
    status: 'committed' as const,
    artifactHash,
    sourceHash,
    transactionHash,
    chainId: 5042002 as const,
    network: 'Arc Testnet' as const,
    explorerUrl: `https://testnet.arcscan.app/tx/${transactionHash}`,
    committedAt: new Date().toISOString(),
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
