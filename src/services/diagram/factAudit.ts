import { isDiagramNode, type DiagramScene } from './types';

export type DiagramFactIssue = { id: string; elementId: string; message: string };

const HIGH_RISK_FACT = /\d{4}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2}\s*日?)?|(?:人民币)?[¥￥]?\s*\d[\d,.]*\s*(?:元|万元|亿元)|(?:案号|编号)[：:]?\s*[（(]?\d{4}[）)][^\s，。；]{2,30}/gu;

function normalize(value: string): string {
  return value.replace(/[\s,，]/gu, '').replaceAll('人民币', '').replaceAll('￥', '¥');
}

/** 只核对日期、金额、案号和明确的原文锚点；普通概括不做武断的“真/假”判断。 */
export function auditDiagramFacts(scene: DiagramScene, markdown?: string): DiagramFactIssue[] {
  if (!markdown) return [];
  const normalizedSource = normalize(markdown);
  const issues: DiagramFactIssue[] = [];
  for (const node of scene.elements.filter(isDiagramNode)) {
    for (const match of node.text.matchAll(HIGH_RISK_FACT)) {
      const fact = match[0];
      if (!normalizedSource.includes(normalize(fact))) {
        issues.push({ id: `fact:${node.id}:${match.index}`, elementId: node.id, message: `日期、金额或编号未在当前 Markdown 找到：${fact}` });
      }
    }
    const anchor = node.source;
    if (anchor?.excerpt && !markdown.includes(anchor.excerpt)) {
      issues.push({ id: `excerpt:${node.id}`, elementId: node.id, message: '节点绑定的原文片段已变化，请重新核对' });
    }
  }
  return issues;
}
