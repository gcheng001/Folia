/**
 * M-B Spike：验证 React Flow v12 × React 19 在本项目可挂载渲染。
 * 临时占位组件，spike 通过后会被真正的 MindMapPane（自澄脉移植）取代。
 *
 * 样式（@xyflow/react/dist/style.css）刻意不在此导入——spike 只验运行时兼容，
 * CSS 在 M-B 正式接线时再随组件挂载。
 */
import { ReactFlow, Background, Controls } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';

const initialNodes: Node[] = [
  { id: 'root', position: { x: 0, y: 0 }, data: { label: '庭审记录' } },
  { id: 'info', position: { x: -220, y: 140 }, data: { label: '一、案件信息' } },
  { id: 'claim', position: { x: 220, y: 140 }, data: { label: '二、诉讼请求' } },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'root', target: 'info' },
  { id: 'e2', source: 'root', target: 'claim' },
];

export function MindMapSpike(): React.ReactElement {
  return (
    <div style={{ width: '100%', height: 400 }}>
      <ReactFlow nodes={initialNodes} edges={initialEdges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
