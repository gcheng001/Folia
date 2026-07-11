/**
 * 上下文样式栏：选中对象后才显示；统一管理节点/箭头/框的颜色/线型等
 * 高频样式项，避免主工具栏臃肿。
 */
import { useMemo } from 'react';
import { DEFAULT_PALETTE, type CustomFlowEdge, type AnnotationGroup } from '../../services/mindmap/canvasSidecar';

export type StyleTarget =
  | { kind: 'node'; ids: string[]; color: string | null }
  | { kind: 'edge'; ids: string[]; style: CustomFlowEdge }
  | { kind: 'group'; ids: string[]; style: AnnotationGroup['style'] };

interface SelectionContextBarProps {
  target: StyleTarget | null;
  colorHistory: string[];
  onPickColor: (color: string) => void;
  onPickCustomColor: (color: string) => void;
  onEdgeStyleChange: (patch: Partial<CustomFlowEdge>) => void;
  onGroupStyleChange: (patch: Partial<AnnotationGroup['style']>) => void;
  onGroupTitleChange: (title: string) => void;
  onDeleteEdges: () => void;
  onDeleteGroups: () => void;
}

const SWATCH: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 4,
  border: '1px solid var(--border, #e5e7eb)',
  cursor: 'pointer',
  display: 'inline-block',
  padding: 0,
};

function EdgeStyleRow({ edge, onChange, onDelete }: {
  edge: CustomFlowEdge;
  onChange: (patch: Partial<CustomFlowEdge>) => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <SegBtn value={edge.arrow} options={[['one-way', '单向'], ['both', '双向'], ['none', '无箭头']]} onChange={(v) => onChange({ arrow: v as CustomFlowEdge['arrow'] })} />
      <SegBtn value={edge.shape} options={[['straight', '直线'], ['step', '折线']]} onChange={(v) => onChange({ shape: v as CustomFlowEdge['shape'] })} />
      <SegBtn value={edge.dash} options={[['solid', '实线'], ['dashed', '虚线']]} onChange={(v) => onChange({ dash: v as CustomFlowEdge['dash'] })} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
        粗细
        <input
          type="range" min={1} max={4} step={0.5}
          value={edge.width}
          onChange={(e) => onChange({ width: Number(e.target.value) })}
        />
      </label>
      <button
        type="button"
        title="删除连线"
        data-testid="mm-delete-edges"
        onClick={onDelete}
        style={{ ...SWATCH, width: 28, color: 'var(--text, #b91c1c)' }}
      >
        ✕
      </button>
    </div>
  );
}

function GroupStyleRow({ style, onChange, onDelete }: {
  style: AnnotationGroup['style'];
  onChange: (patch: Partial<AnnotationGroup['style']>) => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <SegBtn value={style.borderStyle} options={[['solid', '实线'], ['dashed', '虚线']]} onChange={(v) => onChange({ borderStyle: v as 'solid' | 'dashed' })} />
      <SegBtn value={style.fill} options={[['none', '无填充'], ['light', '浅色填充']]} onChange={(v) => onChange({ fill: v as 'none' | 'light' })} />
      <SegBtn value={style.corner} options={[['rounded', '圆角'], ['square', '直角']]} onChange={(v) => onChange({ corner: v as 'rounded' | 'square' })} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
        粗细
        <input
          type="range" min={1} max={4} step={0.5}
          value={style.width}
          onChange={(e) => onChange({ width: Number(e.target.value) })}
        />
      </label>
      <button
        type="button"
        title="删除标注框"
        data-testid="mm-delete-group"
        onClick={onDelete}
        style={{ ...SWATCH, width: 28, color: 'var(--text, #b91c1c)' }}
      >
        ✕
      </button>
    </div>
  );
}

function SegBtn<T extends string>({ value, options, onChange }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, overflow: 'hidden' }}>
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={k === value}
          data-testid={`mm-seg-${k}`}
          style={{
            fontSize: 11,
            padding: '2px 6px',
            border: 'none',
            background: k === value ? 'var(--accent, #3b82f6)' : 'transparent',
            color: k === value ? 'var(--surface, #fff)' : 'var(--text, #1f2937)',
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SelectionContextBar(props: SelectionContextBarProps): React.ReactElement | null {
  const { target, colorHistory, onPickColor, onPickCustomColor } = props;
  const history = useMemo(() => Array.from(new Set([...colorHistory, ...DEFAULT_PALETTE])), [colorHistory]);
  if (!target) return null;
  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    background: 'var(--surface, #fff)',
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: 10,
    padding: 8,
    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 260,
  };
  const currentColor = (() => {
    if (target.kind === 'node') return target.color;
    if (target.kind === 'edge') return target.style.color;
    return target.style.color;
  })();
  return (
    <div style={wrapperStyle} data-testid="mm-context-bar" role="region" aria-label="样式">
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text, #6b7280)' }}>
          {target.kind === 'node' ? `节点 × ${target.ids.length}` : target.kind === 'edge' ? '连线' : '标注框'}
        </span>
        {history.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`mm-color-${c}`}
            title={c}
            aria-label={`颜色 ${c}`}
            aria-pressed={c === currentColor}
            onClick={() => onPickColor(c)}
            style={{
              ...SWATCH,
              background: c,
              outline: c === currentColor ? '2px solid var(--accent, #3b82f6)' : 'none',
            }}
          />
        ))}
        <label style={{ ...SWATCH, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="自定义颜色">
          <input
            type="color"
            data-testid="mm-color-custom"
            onChange={(e) => onPickCustomColor(e.target.value)}
            style={{ width: 0, height: 0, opacity: 0 }}
          />
          <span style={{ fontSize: 14, lineHeight: 1, color: 'var(--text, #6b7280)' }}>＋</span>
        </label>
      </div>
      {target.kind === 'edge' && (
        <EdgeStyleRow
          edge={target.style}
          onChange={props.onEdgeStyleChange}
          onDelete={props.onDeleteEdges}
        />
      )}
      {target.kind === 'group' && (
        <GroupStyleRow
          style={target.style}
          onChange={props.onGroupStyleChange}
          onDelete={props.onDeleteGroups}
        />
      )}
    </div>
  );
}
