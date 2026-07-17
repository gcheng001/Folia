import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { inspectDiagramQuality } from '../services/diagram/collision';
import { prepareDeliverySvg } from '../services/diagram/delivery';
import { followMovedNodes } from '../services/diagram/editing';
import { auditDiagramFacts } from '../services/diagram/factAudit';
import { importLegacySvg } from '../services/diagram/legacySvgImport';
import { projectLegacySvg } from '../services/diagram/legacyProjection';
import { repairDiagramLocally } from '../services/diagram/localRepair';
import { readSceneMetadata, validateDiagramScene, withSceneChecksum } from '../services/diagram/sceneSchema';
import { projectDiagramSvg } from '../services/diagram/svgProjection';
import { isDiagramNode, type DiagramNode, type DiagramScene } from '../services/diagram/types';
import type { SkillVisualStyle } from '../services/skillVisualService';

type Props = {
  source: string;
  fileName: string;
  onChange: (source: string) => void;
  onSaveCopy: (content?: string) => void;
  onUpgradeLegacy: (upgradedSvg: string) => Promise<void>;
  sourceMarkdown?: string;
  onRegenerate?: () => void;
};

type DragState = { pointerId: number; x: number; y: number; scene: DiagramScene };

function parseScene(source: string): DiagramScene | null {
  try { return readSceneMetadata(source); } catch { return null; }
}

function updated(scene: DiagramScene): DiagramScene {
  return withSceneChecksum({ ...scene, document: { ...scene.document, updatedAt: new Date().toISOString() } });
}

function imageData(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function sceneHistory(scene: DiagramScene | null): DiagramScene[] {
  if (!scene?.history) return [];
  return scene.history.flatMap((entry) => {
    try { return [validateDiagramScene(JSON.parse(entry.sceneJson))]; } catch { return []; }
  });
}

function historyEntry(scene: DiagramScene, label = '编辑图表') {
  const snapshot = withSceneChecksum({ ...structuredClone(scene), history: [] });
  return { id: `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, label, createdAt: new Date().toISOString(), sceneJson: JSON.stringify(snapshot) };
}

export function DiagramEditorPane({ source, fileName, onChange, onSaveCopy, onUpgradeLegacy, sourceMarkdown, onRegenerate }: Props) {
  const parsed = useMemo(() => parseScene(source), [source]);
  const [editing, setEditing] = useState(false);
  const [scene, setScene] = useState<DiagramScene | null>(parsed);
  const [selectedId, setSelectedId] = useState<string>();
  const [past, setPast] = useState<DiagramScene[]>(() => sceneHistory(parsed));
  const [future, setFuture] = useState<DiagramScene[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const drag = useRef<DragState | undefined>(undefined);
  const idCounter = useRef(0);
  const selected = scene?.elements.find((element): element is DiagramNode => isDiagramNode(element) && element.id === selectedId);
  const issues = scene ? inspectDiagramQuality(scene) : [];
  const factIssues = scene ? auditDiagramFacts(scene, sourceMarkdown) : [];
  const exportBlocked = issues.some((issue) => issue.severity === 'error') || factIssues.length > 0;

  const project = (next: DiagramScene): string => next.document.legacyProjection
    ? projectLegacySvg(source, next)
    : projectDiagramSvg(next);

  const commit = (nextInput: DiagramScene, record = true) => {
    if (!scene) return;
    followMovedNodes(record ? scene : (drag.current?.scene ?? scene), nextInput);
    const next = updated(nextInput);
    if (record) {
      setPast((items) => [...items.slice(-49), scene]);
      setFuture([]);
      next.history = [...(scene.history ?? []).slice(-49), historyEntry(scene)];
    }
    setScene(next);
    onChange(project(next));
  };

  const mutateSelected = (change: (node: DiagramNode) => void, record = true) => {
    if (!scene || !selectedId) return;
    const next = structuredClone(scene);
    const node = next.elements.find((element): element is DiagramNode => isDiagramNode(element) && element.id === selectedId);
    if (!node) return;
    change(node);
    commit(next, record);
  };

  const startEditing = async () => {
    setError(undefined);
    if (parsed) { setScene(parsed); setEditing(true); return; }
    setBusy(true);
    try {
      const upgraded = importLegacySvg(source, fileName);
      await onUpgradeLegacy(upgraded.upgradedSvg);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    if (!scene || past.length === 0) return;
    const previous = past.at(-1)!;
    const remaining = past.slice(0, -1);
    const restored = withSceneChecksum({ ...structuredClone(previous), history: (scene.history ?? []).slice(0, -1) });
    setPast(remaining);
    setFuture((items) => [scene, ...items].slice(0, 50));
    setScene(restored);
    onChange(project(restored));
  };
  const redo = () => {
    if (!scene || future.length === 0) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-49), scene]);
    const restored = withSceneChecksum({ ...structuredClone(next), history: [...(scene.history ?? []), historyEntry(scene)].slice(-50) });
    setScene(restored);
    onChange(project(restored));
  };

  const addNode = () => {
    if (!scene) return;
    const next = structuredClone(scene);
    idCounter.current += 1;
    const id = `node-${scene.document.id}-${idCounter.current}`;
    next.elements.push({ id, kind: 'node', text: '新节点', bounds: { x: 60, y: 60, width: 160, height: 64 }, style: { fontSize: 14 } });
    setSelectedId(id);
    commit(next);
  };
  const deleteSelected = () => {
    if (!scene || !selectedId) return;
    const next = structuredClone(scene);
    next.elements = next.elements.filter((element) => element.id !== selectedId && !(element.kind === 'edge' && (element.sourceId === selectedId || element.targetId === selectedId)));
    setSelectedId(undefined);
    commit(next);
  };
  const connectTo = (targetId: string) => {
    if (!scene || !selectedId || !targetId || targetId === selectedId) return;
    const next = structuredClone(scene);
    idCounter.current += 1;
    next.elements.push({ id: `edge-${scene.document.id}-${idCounter.current}`, kind: 'edge', sourceId: selectedId, targetId, style: { arrow: 'end' } });
    commit(next);
  };

  const pointerDown = (event: ReactPointerEvent<SVGRectElement>, node: DiagramNode) => {
    if (!scene) return;
    setSelectedId(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scene: structuredClone(scene) };
  };
  const pointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const start = drag.current;
    if (!start || !scene || event.pointerId !== start.pointerId) return;
    const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const scaleX = scene.canvas.width / bounds.width;
    const scaleY = scene.canvas.height / bounds.height;
    const next = structuredClone(start.scene);
    const node = next.elements.find((element): element is DiagramNode => isDiagramNode(element) && element.id === selectedId);
    if (!node) return;
    const dx = (event.clientX - start.x) * scaleX;
    const dy = (event.clientY - start.y) * scaleY;
    node.bounds.x += dx;
    node.bounds.y += dy;
    commit(next, false);
  };
  const pointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    setPast((items) => [...items.slice(-49), start.scene]);
    setFuture([]);
    if (scene) {
      const recorded = withSceneChecksum({ ...scene, history: [...(start.scene.history ?? []).slice(-49), historyEntry(start.scene, '移动节点')] });
      setScene(recorded);
      onChange(project(recorded));
    }
    drag.current = undefined;
  };

  if (!editing || !scene) {
    const routing = parsed?.document.routing;
    return (
      <section className="svg-preview-pane" aria-label="SVG 成品图预览">
        <header className="svg-preview-header">
          <div>
            <strong>{fileName}</strong><span>旧图会先生成可编辑副本，原文件不会覆盖。</span>
            {routing && <span className="diagram-routing-note" title="生成时的场景路由结论">场景 {routing.sceneId}：{routing.selectionReason}</span>}
          </div>
          <div className="svg-preview-actions">
            {onRegenerate && <button type="button" className="svg-preview-save" onClick={onRegenerate}>重新生成</button>}
            <button type="button" className="svg-preview-save" onClick={() => void startEditing()} disabled={busy}>{busy ? '正在升级…' : parsed ? '开始编辑' : '升级并编辑'}</button>
            <button type="button" className="svg-preview-save" onClick={() => onSaveCopy(prepareDeliverySvg(source))}>另存副本</button>
          </div>
        </header>
        {error && <div className="diagram-editor-error" role="alert">{error}</div>}
        <div className="svg-preview-canvas"><div className="svg-preview-sheet"><img src={imageData(source)} alt={fileName} draggable={false} /></div></div>
      </section>
    );
  }

  return (
    <section className="diagram-editor-pane" aria-label="可编辑图表">
      <header className="diagram-editor-toolbar">
        <strong>{fileName}</strong>
        <button type="button" onClick={undo} disabled={!past.length}>撤销</button>
        <button type="button" onClick={redo} disabled={!future.length}>重做</button>
        <button type="button" onClick={addNode}>添加节点</button>
        <button type="button" onClick={deleteSelected} disabled={!selected}>删除</button>
        <button type="button" onClick={() => commit(repairDiagramLocally(scene))}>自动消除重叠</button>
        {onRegenerate && <button type="button" onClick={onRegenerate}>重新生成</button>}
        <select aria-label="图表风格" value={scene.document.style} onChange={(event) => commit({ ...scene, document: { ...scene.document, style: event.target.value as SkillVisualStyle } })}>
          <option value="light-formal">正式浅色</option><option value="business">商务</option><option value="dark-tech">深色</option><option value="soft-color">柔和</option>
        </select>
        <span className={issues.some((issue) => issue.severity === 'error') ? 'diagram-quality-bad' : 'diagram-quality-ok'}>{issues.length ? `${issues.length} 个排版问题` : '排版检查通过'}</span>
        <span className={factIssues.length ? 'diagram-quality-bad' : 'diagram-quality-ok'}>{factIssues.length ? `${factIssues.length} 个事实待核对` : sourceMarkdown ? '关键事实检查通过' : '未绑定 Markdown'}</span>
        <button type="button" onClick={() => onSaveCopy(prepareDeliverySvg(source))} disabled={exportBlocked} title={exportBlocked ? '请先修复排版问题并核对关键事实' : '导出不含编辑数据的 SVG'}>导出副本</button>
      </header>
      {scene.document.routing && (
        <p className="diagram-routing-note" title="生成时的场景路由结论">
          场景 {scene.document.routing.sceneId}：{scene.document.routing.selectionReason}
        </p>
      )}
      <div className="diagram-editor-body">
        <div className="diagram-editor-canvas">
          <div className="diagram-editor-stage" style={{ aspectRatio: `${scene.canvas.width} / ${scene.canvas.height}` }}>
            <img src={imageData(source)} alt={fileName} draggable={false} />
            <svg viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`} aria-label="图表编辑画布">
              {scene.elements.filter(isDiagramNode).map((node) => <rect key={node.id} x={node.bounds.x} y={node.bounds.y} width={node.bounds.width} height={node.bounds.height} className={node.id === selectedId ? 'selected' : ''} onPointerDown={(event) => pointerDown(event, node)} onPointerMove={pointerMove} onPointerUp={pointerUp} />)}
            </svg>
          </div>
        </div>
        <aside className="diagram-editor-inspector">
          {selected ? <>
            {factIssues.filter((issue) => issue.elementId === selected.id).map((issue) => <p key={issue.id} className="diagram-quality-bad">{issue.message}</p>)}
            <label>文字<textarea value={selected.text} onChange={(event) => mutateSelected((node) => { node.text = event.target.value; node.protected = { ...node.protected, text: true }; })} /></label>
            <div className="diagram-editor-grid">
              {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key}<input type="number" value={Math.round(selected.bounds[key])} onChange={(event) => mutateSelected((node) => { node.bounds[key] = Math.max(key === 'width' || key === 'height' ? 20 : 0, Number(event.target.value)); })} /></label>)}
            </div>
            <label>字号<input type="number" min="10" max="48" value={selected.style?.fontSize ?? 14} onChange={(event) => mutateSelected((node) => { node.style = { ...node.style, fontSize: Number(event.target.value) }; })} /></label>
            <label>填充色<input type="color" value={selected.style?.fill ?? '#ffffff'} onChange={(event) => mutateSelected((node) => { node.style = { ...node.style, fill: event.target.value }; })} /></label>
            <label>连接到<select defaultValue="" onChange={(event) => { connectTo(event.target.value); event.target.value = ''; }}><option value="">选择目标节点</option>{scene.elements.filter(isDiagramNode).filter((node) => node.id !== selected.id).map((node) => <option key={node.id} value={node.id}>{node.text.slice(0, 24)}</option>)}</select></label>
          </> : <p>点选方框后可编辑文字、位置、尺寸、颜色和连接。</p>}
        </aside>
      </div>
    </section>
  );
}
