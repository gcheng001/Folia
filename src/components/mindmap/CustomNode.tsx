/**
 * M-B 只读画布节点（自澄脉 `CustomNode.tsx` 简化移植）。
 * 去掉编辑态（LexicalEditor/zustand store/selection），只保留展示：
 * 白底卡片 + 左侧色条按 outline 深度区分层级。
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

const LEVEL_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9'];

function levelColor(level: number): string {
  return LEVEL_COLORS[Math.max(0, level - 1) % LEVEL_COLORS.length];
}

interface CustomNodeData {
  label: string;
  kind: string;
  level: number;
  [key: string]: unknown;
}

export const CustomNode = memo(({ data }: NodeProps) => {
  const { label, level } = data as unknown as CustomNodeData;

  const nodeStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    borderLeft: `3px solid ${levelColor(level)}`,
    backgroundColor: 'var(--surface, #fff)',
    color: 'var(--text, #1f2937)',
    fontSize: '14px',
    fontFamily: 'var(--font-body)',
    minWidth: '80px',
    maxWidth: '300px',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
  };

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: '#6b7280', border: 'none' }} />
      <div style={nodeStyle}>
        <span>{label}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#6b7280', border: 'none' }} />
    </>
  );
});

CustomNode.displayName = 'CustomNode';
