/**
 * M-B 只读脑图画布。接收原始 Markdown，内部 parse → layout → 渲染。
 * 不支持编辑回写、拖拽重排、折叠展开——纯只读可视化（MD 仍是唯一源）。
 */
import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseMarkdown } from '../../services/mindmap/parser';
import { layoutMindMap } from '../../services/mindmap/layout';
import { CustomNode } from './CustomNode';
import { CustomEdge } from './CustomEdge';

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

interface MindMapPaneProps {
  markdown: string;
}

export function MindMapPane({ markdown }: MindMapPaneProps): React.ReactElement {
  const { nodes, edges } = useMemo(() => {
    const doc = parseMarkdown(markdown);
    const { nodes: rawNodes, edges: rawEdges } = layoutMindMap(doc.root);
    return {
      nodes: rawNodes.map((n) => ({ ...n, type: 'custom' })),
      edges: rawEdges.map((e) => ({ ...e, type: 'custom' })),
    };
  }, [markdown]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
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
