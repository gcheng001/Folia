/**
 * M-B 只读画布节点。简洁直线条形态（PRD 项 B）：
 * 非根节点为纯文字 + 分支色下划线；根节点为轻量描边胶囊。
 * 配色由主题（themes.ts）驱动，经 MindMapPane 注入 node.data.theme。
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { branchColor, getTheme, type MindMapTheme } from './themes';

interface CustomNodeData {
  label: string;
  kind: string;
  level: number;
  branchIndex: number;
  isRoot: boolean;
  theme?: MindMapTheme;
  [key: string]: unknown;
}

const handleStyle: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: 'none' };

export const CustomNode = memo(({ data }: NodeProps) => {
  const { label, branchIndex, isRoot, theme: maybeTheme } = data as unknown as CustomNodeData;
  const theme = maybeTheme ?? getTheme(undefined);
  const color = branchColor(theme, branchIndex ?? -1);

  const nodeStyle: React.CSSProperties = isRoot
    ? {
        padding: '8px 18px',
        border: `2px solid ${theme.root}`,
        borderRadius: '18px',
        backgroundColor: 'var(--surface, #fff)',
        color: theme.root,
        fontSize: '15px',
        fontWeight: 600,
        fontFamily: 'var(--font-body)',
        maxWidth: '300px',
      }
    : {
        padding: '2px 10px 4px',
        borderBottom: `2px solid ${color}`,
        color: theme.text,
        fontSize: '14px',
        fontFamily: 'var(--font-body)',
        minWidth: '40px',
        maxWidth: '300px',
      };

  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={nodeStyle}>
        <span>{label}</span>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  );
});

CustomNode.displayName = 'CustomNode';
