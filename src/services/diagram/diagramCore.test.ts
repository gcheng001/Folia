import { describe, expect, it } from 'vitest';
// jsdom 环境下 node:fs 会被 vite 外部化导致整套用例无法加载(本文件需要
// DOMParser,不能切到 node 环境),改用 vite 的 ?raw 导入读取真实旧图 fixture。
import mindmapLegacyFixture from '../../../docs/validation/editable-visual/fixtures/民事答辩状-脑图-legacy.svg?raw';
import relationshipLegacyFixture from '../../../docs/validation/editable-visual/fixtures/民事答辩状-关系图-legacy.svg?raw';
import { inspectDiagramQuality } from './collision';
import { prepareDeliverySvg } from './delivery';
import { auditDiagramFacts } from './factAudit';
import { importLegacySvg } from './legacySvgImport';
import { projectLegacySvg } from './legacyProjection';
import { repairDiagramLocally } from './localRepair';
import { readSceneMetadata, stripSceneMetadata, validateDiagramScene, withSceneChecksum } from './sceneSchema';
import { projectDiagramSvg } from './svgProjection';
import { structureToScene, validateVisualStructure } from './structure';
import { fallbackTextMeasurer, wrapText } from './textMeasure';
import { isDiagramNode, type DiagramScene } from './types';

function scene(): DiagramScene {
  const now = '2026-07-13T00:00:00.000Z';
  return withSceneChecksum({
    version: 1,
    checksum: '',
    document: { id: 'test', title: '测试', visualType: 'flowchart', style: 'light-formal', createdAt: now, updatedAt: now },
    canvas: { width: 600, height: 400, background: '#fff', padding: 24 },
    elements: [
      { id: 'a', kind: 'node', text: '这是第一段需要自动换行的中文', bounds: { x: 20, y: 20, width: 180, height: 80 } },
      { id: 'b', kind: 'node', text: '第二节点', bounds: { x: 130, y: 50, width: 180, height: 80 } },
      { id: 'e', kind: 'edge', sourceId: 'a', targetId: 'b' },
    ],
    history: [],
  });
}

describe('diagram core', () => {
  it('wraps Chinese using measured width instead of character-count coordinates', () => {
    const wrapped = wrapText('中华人民共和国民事答辩状', 84, { fontFamily: 'sans-serif', fontSize: 14 }, fallbackTextMeasurer);
    expect(wrapped.lines.length).toBeGreaterThan(1);
    expect(wrapped.lines.every((line) => fallbackTextMeasurer(line, { fontFamily: 'sans-serif', fontSize: 14 }) <= 84)).toBe(true);
  });

  it('detects overlap and local repair moves only a movable conflicted node', () => {
    const input = scene();
    expect(inspectDiagramQuality(input, fallbackTextMeasurer).some((issue) => issue.kind === 'node-overlap')).toBe(true);
    const repaired = repairDiagramLocally(input);
    expect(inspectDiagramQuality(repaired, fallbackTextMeasurer).some((issue) => issue.kind === 'node-overlap')).toBe(false);
    expect((repaired.elements[0] as { bounds: { x: number; y: number } }).bounds).toEqual({ x: 20, y: 20, width: 180, height: 80 });
  });

  it('embeds a checksummed scene and removes metadata for delivery', () => {
    const editable = projectDiagramSvg(scene(), { measure: fallbackTextMeasurer });
    const parsed = readSceneMetadata(editable);
    expect(parsed?.document.id).toBe('test');
    expect(() => validateDiagramScene(parsed)).not.toThrow();
    const delivery = stripSceneMetadata(editable);
    expect(delivery).not.toContain('folia-editable-visual');
    expect(delivery).toContain('<svg');
  });

  it('projects a visible title, emphasized node, and edge label', async () => {
    const laidOut = await structureToScene({
      version: 1,
      title: '案件主线',
      nodes: [
        { id: 'root', text: '核心结论', emphasis: 'strong' },
        { id: 'fact', text: '关键事实' },
      ],
      edges: [{ id: 'edge', sourceId: 'root', targetId: 'fact', label: '依据' }],
    }, { visualType: 'mindmap', style: 'light-formal', measure: fallbackTextMeasurer });
    const svg = projectDiagramSvg(laidOut, { editable: false, measure: fallbackTextMeasurer });
    expect(svg).toContain('案件主线');
    expect(svg).toContain('依据');
    expect(svg).toContain('#f3e5d9');
    expect(laidOut.elements.filter(isDiagramNode).every((node) => node.bounds.y >= 82)).toBe(true);
  });

  it('sanitizes delivery SVG and removes editable metadata', () => {
    const editable = projectDiagramSvg(scene(), { measure: fallbackTextMeasurer });
    const dirty = editable.replace('</svg>', '<script>alert(1)</script><image href="https://example.com/a.png" onload="x()"/></svg>');
    const delivery = prepareDeliverySvg(dirty);
    expect(delivery).not.toContain('folia-editable-visual');
    expect(delivery).not.toContain('<script');
    expect(delivery).not.toContain('https://');
    expect(delivery).not.toContain('onload');
    expect(delivery).not.toContain('data-folia-id');
  });

  it('audits high-risk dates and amounts against the current Markdown', () => {
    const input = scene();
    const node = input.elements.find(isDiagramNode)!;
    node.text = '2025年3月2日支付人民币100万元';
    const checked = withSceneChecksum(input);
    expect(auditDiagramFacts(checked, '双方于2025年3月2日确认支付100万元。')).toEqual([]);
    expect(auditDiagramFacts(checked, '双方于2025年3月3日确认支付80万元。')).toHaveLength(2);
  });

  it('upgrades a legacy SVG without changing its existing visual payload', () => {
    const original = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220"><rect x="20" y="20" width="160" height="60" fill="#fff" stroke="#333"/><text x="40" y="55">原有文字</text><rect x="220" y="120" width="150" height="60"/><text x="240" y="155">第二节点</text><line x1="180" y1="50" x2="220" y2="150" stroke="#333"/></svg>';
    const upgraded = importLegacySvg(original, '旧图');
    expect(upgraded.scene.elements.filter((element) => element.kind === 'node')).toHaveLength(2);
    expect(stripSceneMetadata(upgraded.upgradedSvg)).toBe(original);
    expect(readSceneMetadata(upgraded.upgradedSvg)?.document.legacyProjection).toBe(true);
  });

  it('edits legacy text without replacing unrelated artwork', () => {
    const original = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160"><circle cx="20" cy="20" r="8" fill="red"/><rect x="50" y="40" width="180" height="70" fill="#fff"/><text x="140" y="80">旧文字</text></svg>';
    const { scene: imported } = importLegacySvg(original);
    imported.elements.find(isDiagramNode)!.text = '新文字';
    const projected = projectLegacySvg(original, withSceneChecksum(imported));
    expect(projected).toContain('<circle cx="20" cy="20" r="8" fill="red"/>');
    expect(projected).toContain('新文字');
    expect(stripSceneMetadata(projected)).not.toContain('旧文字');
    expect(readSceneMetadata(projected)?.elements.find(isDiagramNode)?.text).toBe('新文字');
  });

  it('rejects active or external legacy SVG content', () => {
    expect(() => importLegacySvg('<svg><script>alert(1)</script></svg>')).toThrow(/不安全/);
    expect(() => importLegacySvg('<svg><image href="https://example.com/a.png"/></svg>')).toThrow(/不安全/);
  });

  it('lays out a structured diagram locally without node or text overlap', async () => {
    const structured = validateVisualStructure({
      version: 1,
      title: '本地布局',
      nodes: [
        { id: 'root', text: '交易关系与核心争议焦点', emphasis: 'strong' },
        { id: 'a', text: '这是一段很长的中文节点内容，需要按照真实测量结果自动换行，而不是由模型猜坐标' },
        { id: 'b', text: '第二个事实节点' },
      ],
      edges: [
        { id: 'e1', sourceId: 'root', targetId: 'a' },
        { id: 'e2', sourceId: 'root', targetId: 'b' },
      ],
    });
    const laidOut = await structureToScene(structured, { visualType: 'relationship', style: 'light-formal', measure: fallbackTextMeasurer });
    const issues = inspectDiagramQuality(laidOut, fallbackTextMeasurer);
    expect(issues.filter((issue) => ['node-overlap', 'text-overflow'].includes(issue.kind))).toEqual([]);
    expect(laidOut.elements.filter((element) => element.kind === 'edge').every((edge) => edge.kind === 'edge' && (edge.points?.length ?? 0) >= 2)).toBe(true);
  });

  it('carries the routing conclusion into the scene and the persisted SVG metadata', async () => {
    const structured = validateVisualStructure({
      version: 1,
      title: '当事人关系',
      nodes: [
        { id: 'root', text: '买卖合同关系' },
        { id: 'a', text: '出卖人甲公司' },
      ],
      edges: [{ id: 'e1', sourceId: 'root', targetId: 'a' }],
      routing: { scene_id: 'REL-PARTIES', selection_reason: '多主体合同关系是核心争点' },
    });
    const laidOut = await structureToScene(structured, { visualType: 'relationship', style: 'light-formal', measure: fallbackTextMeasurer });
    expect(laidOut.document.routing).toEqual({ sceneId: 'REL-PARTIES', selectionReason: '多主体合同关系是核心争点' });
    const projected = projectDiagramSvg(withSceneChecksum(laidOut), { measure: fallbackTextMeasurer });
    expect(readSceneMetadata(projected)?.document.routing).toEqual({ sceneId: 'REL-PARTIES', selectionReason: '多主体合同关系是核心争点' });
  });

  it('keeps routing optional for the deterministic path but rejects malformed routing', async () => {
    const base = {
      version: 1,
      title: '本地确定性布局',
      nodes: [{ id: 'root', text: '仅有一个节点' }],
      edges: [],
    };
    const withoutRouting = validateVisualStructure(base);
    const laidOut = await structureToScene(withoutRouting, { visualType: 'mindmap', style: 'business', measure: fallbackTextMeasurer });
    expect(laidOut.document.routing).toBeUndefined();
    expect(() => validateVisualStructure({ ...base, routing: null })).toThrow('生成结果的场景路由结论无效');
    expect(() => validateVisualStructure({ ...base, routing: { scene_id: '', selection_reason: '理由' } })).toThrow('生成结果的场景路由结论无效');
    expect(() => validateVisualStructure({ ...base, routing: { scene_id: 'MIND-ISSUES', selection_reason: '   ' } })).toThrow('生成结果的场景路由结论无效');
  });

  it('imports both required real legacy SVG fixtures and detects their known overlaps', () => {
    const fixtures = [mindmapLegacyFixture, relationshipLegacyFixture];
    for (const svg of fixtures) {
      const imported = importLegacySvg(svg);
      const issues = inspectDiagramQuality(imported.scene, fallbackTextMeasurer);
      expect(imported.scene.elements.some((element) => element.kind === 'node')).toBe(true);
      expect(issues.some((issue) => issue.kind === 'node-overlap' || issue.kind === 'legacy-text-overlap')).toBe(true);
      const repaired = repairDiagramLocally(imported.scene);
      const remaining = inspectDiagramQuality(repaired, fallbackTextMeasurer);
      expect(remaining).toEqual([]);
      expect(stripSceneMetadata(imported.upgradedSvg)).toBe(svg);
    }
  });

  it('grows an undersized native text box during local repair', () => {
    const input = scene();
    const node = input.elements.find(isDiagramNode)!;
    node.bounds.height = 24;
    const repaired = repairDiagramLocally(withSceneChecksum(input));
    expect(inspectDiagramQuality(repaired, fallbackTextMeasurer).filter((issue) => issue.kind === 'text-overflow')).toEqual([]);
  });

  it('stress-lays out a long 180-node legal diagram without overlap', async () => {
    const nodes = Array.from({ length: 180 }, (_, index) => ({
      id: `n${index}`,
      text: `第${index + 1}项事实：这是一段用于压力验收的较长中文法律文档节点内容`,
      emphasis: index === 0 ? 'strong' as const : 'normal' as const,
    }));
    const edges = nodes.slice(1).map((node, index) => ({ id: `e${index}`, sourceId: nodes[Math.floor(index / 3)].id, targetId: node.id }));
    const laidOut = await structureToScene({ version: 1, title: '压力验收', nodes, edges }, { visualType: 'mindmap', style: 'business', measure: fallbackTextMeasurer });
    const issues = inspectDiagramQuality(laidOut, fallbackTextMeasurer);
    expect(issues.filter((issue) => issue.kind === 'node-overlap' || issue.kind === 'text-overflow')).toEqual([]);
    expect(laidOut.canvas.width).toBeGreaterThan(640);
    expect(laidOut.elements).toHaveLength(359);
  }, 15_000);
});
