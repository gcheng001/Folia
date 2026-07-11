/**
 * 脑图画布节点。简洁直线条形态（PRD 项 B）：
 * 非根节点为纯文字 + 分支色下划线；根节点为轻量描边胶囊。
 * 配色由主题（themes.ts）驱动；编辑态（M-C）渲染行内输入框，
 * Enter 提交 / Esc 取消，事件不冒泡到画布键盘处理器。
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
  editable?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  onStartEdit?: (nodeId: string) => void;
  onCommitEdit?: (lineIndex: number, text: string) => void;
  onCancelEdit?: (lineIndex: number) => void;
  [key: string]: unknown;
}

const handleStyle: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: 'none' };

export const CustomNode = memo(({ id, data }: NodeProps) => {
  const {
    label,
    branchIndex,
    isRoot,
    theme: maybeTheme,
    isSelected,
    isEditing,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
  } = data as unknown as CustomNodeData;
  const theme = maybeTheme ?? getTheme(undefined);
  const color = branchColor(theme, branchIndex ?? -1);
  const lineIndex = Number(id.slice(1));

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

  if (isSelected && !isEditing) {
    nodeStyle.boxShadow = `0 0 0 2px ${color}55, 0 0 0 4px ${color}22`;
    nodeStyle.borderRadius = nodeStyle.borderRadius ?? '4px';
  }

  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div
        className="nodrag nowheel nopan"
        style={nodeStyle}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStartEdit?.(id);
        }}
      >
        {isEditing ? (
          <input
            className="nodrag nowheel nopan"
            autoFocus
            defaultValue={label}
            aria-label="编辑节点文字"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEdit?.(lineIndex, e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelEdit?.(lineIndex);
              } else if (e.key === 'Tab') {
                // 输入态不做层级操作，也不让浏览器移动焦点
                e.preventDefault();
              }
            }}
            onBlur={(e) => onCommitEdit?.(lineIndex, e.currentTarget.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              font: 'inherit',
              color: 'inherit',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              width: `${Math.max(6, label.length + 2)}em`,
              maxWidth: '280px',
            }}
          />
        ) : (
          <span>{label || '(未命名)'}</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  );
});

CustomNode.displayName = 'CustomNode';
