/**
 * M-B 只读脑图画布。接收原始 Markdown，内部 parse → layout → 渲染。
 * 不支持编辑回写、拖拽重排、折叠展开——纯只读可视化（MD 仍是唯一源）。
 * 主题（PRD 项 B）：四套简洁直线条主题，右上角切换，localStorage 记住选择。
 */
import { useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseMarkdown } from '../../services/mindmap/parser';
import { layoutMindMap } from '../../services/mindmap/layout';
import { CustomNode } from './CustomNode';
import { CustomEdge } from './CustomEdge';
import {
  MINDMAP_THEMES,
  branchColor,
  getTheme,
  loadThemeId,
  saveThemeId,
  type MindMapThemeId,
} from './themes';

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

interface MindMapPaneProps {
  markdown: string;
  /** 虚拟根显示名（文档无大标题时的中心节点文本），一般传文件名 */
  fileName?: string;
}

const switcherStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 5,
  display: 'flex',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  backgroundColor: 'var(--surface, #fff)',
  border: '1px solid var(--border, #e5e7eb)',
};

export function MindMapPane({ markdown, fileName = '' }: MindMapPaneProps): React.ReactElement {
  const [themeId, setThemeId] = useState<MindMapThemeId>(loadThemeId);
  const theme = getTheme(themeId);

  const { nodes, edges } = useMemo(() => {
    const doc = parseMarkdown(markdown, fileName);
    const { nodes: rawNodes, edges: rawEdges } = layoutMindMap(doc.root);
    return {
      nodes: rawNodes.map((n) => ({ ...n, type: 'custom', data: { ...n.data, theme } })),
      edges: rawEdges.map((e) => ({
        ...e,
        type: 'custom',
        style: {
          stroke: branchColor(theme, (e.data?.branchIndex as number | undefined) ?? -1),
          strokeWidth: theme.edgeWidth,
        },
      })),
    };
  }, [markdown, fileName, theme]);

  const selectTheme = (id: MindMapThemeId): void => {
    setThemeId(id);
    saveThemeId(id);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={switcherStyle} role="radiogroup" aria-label="脑图主题">
        {MINDMAP_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === themeId}
            title={t.name}
            onClick={() => selectTheme(t.id)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              cursor: 'pointer',
              border: t.id === themeId ? '2px solid var(--text, #1f2937)' : '1px solid var(--border, #e5e7eb)',
              background:
                t.branchColors.length > 1
                  ? `conic-gradient(${t.branchColors.slice(0, 4).join(', ')})`
                  : t.branchColors[0],
            }}
          />
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="oklch(89% 0.012 80)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
