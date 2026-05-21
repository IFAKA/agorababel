import type { CircleAgentWalletStatus } from '../app/pipeline/analysisSchema';
import { getRuntimeConfig } from './config';

export async function getCircleAgentWalletStatus(): Promise<CircleAgentWalletStatus> {
  const config = getRuntimeConfig();
  const checkedAt = new Date().toISOString();

  if (!config.circleApiKey || !config.circleWalletSetId || !config.circleAgentWalletId || !config.circleAgentWalletAddress) {
    return {
      status: 'unconfigured',
      walletId: config.circleAgentWalletId || null,
      walletSetId: config.circleWalletSetId || null,
      address: normalizeAddress(config.circleAgentWalletAddress),
      blockchain: 'ARC-TESTNET',
      checkedAt,
      error: 'Circle ARC-TESTNET wallet environment variables are incomplete.',
    };
  }

  try {
    const response = await fetch(`https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(config.circleAgentWalletId)}`, {
      headers: {
        Authorization: `Bearer ${config.circleApiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return {
        status: 'failed',
        walletId: config.circleAgentWalletId,
        walletSetId: config.circleWalletSetId,
        address: normalizeAddress(config.circleAgentWalletAddress),
        blockchain: 'ARC-TESTNET',
        checkedAt,
        error: `Circle wallet lookup returned HTTP ${response.status}.`,
      };
    }

    return {
      status: 'ready',
      walletId: config.circleAgentWalletId,
      walletSetId: config.circleWalletSetId,
      address: normalizeAddress(config.circleAgentWalletAddress),
      blockchain: 'ARC-TESTNET',
      checkedAt,
      error: null,
    };
  } catch (error) {
    return {
      status: 'failed',
      walletId: config.circleAgentWalletId,
      walletSetId: config.circleWalletSetId,
      address: normalizeAddress(config.circleAgentWalletAddress),
      blockchain: 'ARC-TESTNET',
      checkedAt,
      error: error instanceof Error ? error.message : 'Circle wallet lookup failed.',
    };
  }
}

function normalizeAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;
}
