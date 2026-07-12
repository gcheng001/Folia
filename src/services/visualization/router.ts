import { evaluateFamily } from './families';
import { parseMarkdownBlocks } from './source';
import type { ViewEvaluator, ViewFamily, ViewFit, ViewRecommendation } from './types';

const FAMILY_ORDER: ViewFamily[] = ['timeline', 'relationship', 'flow', 'matrix', 'charts', 'structure-overview'];

export const VIEW_EVALUATORS: readonly ViewEvaluator[] = FAMILY_ORDER.map((family) => ({
  family,
  label: ({
    timeline: '时间轴',
    relationship: '关系网络',
    flow: '流程与决策',
    matrix: '矩阵与对比',
    charts: '数值图表',
    'structure-overview': '结构总览',
  } as const)[family],
  evaluate: (blocks, source) => evaluateFamily(family, source, blocks),
}));

function stableFit(fit: ViewFit): ViewFit {
  return {
    ...fit,
    score: Math.max(0, Math.min(100, Math.round(fit.score))),
    evidence: [...fit.evidence].sort((a, b) => a.code.localeCompare(b.code)),
    missing: [...fit.missing].sort(),
    review: [...fit.review].sort(),
  };
}

export function evaluateViews(source: string, evaluators: readonly ViewEvaluator[] = VIEW_EVALUATORS): ViewFit[] {
  const blocks = parseMarkdownBlocks(source);
  return evaluators
    .map((evaluator) => stableFit(evaluator.evaluate(blocks, source)))
    .sort((a, b) => b.score - a.score || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
}

export function recommendView(source: string): ViewRecommendation {
  const fits = evaluateViews(source);
  const primary = fits[0];
  const runnerUp = fits[1];
  return {
    mode: primary.score >= 75 && primary.score - runnerUp.score >= 10 ? 'direct' : 'choose',
    primary,
    candidates: fits.filter((fit) => fit.score > 0).slice(0, 3),
  };
}
