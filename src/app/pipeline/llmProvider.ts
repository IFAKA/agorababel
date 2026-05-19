import type { PipelineInput, PipelineProvider, PipelineRunUpdate } from './types';
import { validateLlmMarketDraft, validateLlmSourceAnalysis } from './schemas';

type ExternalLlmStructuredOutput = {
  sourceAnalysis: unknown;
  marketDraft: unknown;
};

export class LlmPipelineProvider implements PipelineProvider {
  async *run(_input: PipelineInput): AsyncGenerator<PipelineRunUpdate> {
    throw new Error('LlmPipelineProvider is not configured for this environment.');
  }

  protected validateStructuredOutput(output: ExternalLlmStructuredOutput) {
    const sourceAnalysis = validateLlmSourceAnalysis(output.sourceAnalysis);
    if (!sourceAnalysis.success) {
      throw new Error(sourceAnalysis.error);
    }

    const marketDraft = validateLlmMarketDraft(output.marketDraft);
    if (!marketDraft.success) {
      throw new Error(marketDraft.error);
    }

    return {
      sourceAnalysis: sourceAnalysis.data,
      marketDraft: marketDraft.data,
    };
  }
}
