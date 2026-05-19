import { sampleArticleText } from '../sampleArticleData';
import { createPendingPipelineRun } from './simulatedProvider';
import type { PipelineRun, PipelineRunUpdate } from './types';

export const fixturePipelineRun = createPendingPipelineRun(sampleArticleText) satisfies PipelineRun;

export const fixturePipelineRunUpdate = {
  type: 'run-started',
  run: fixturePipelineRun,
} satisfies PipelineRunUpdate;
