/**
 * 选中节点的对齐/等间距：纯函数，零 React 依赖。
 *
 * 输入是一组节点的「位置 + 估算尺寸」，返回新的位置集合。坐标以节点
 * 自身极值/中心为基准，保证整组不会无故跳走。
 */
import type { MindMapPosition } from './positionStore';

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignKind = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type DistributeKind = 'horizontal' | 'vertical';

interface BBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

function bboxOf(box: NodeBox): BBox {
  return {
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
  };
}

function boxesBBox(boxes: NodeBox[]): BBox {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const b of boxes) {
    const bb = bboxOf(b);
    if (bb.left < left) left = bb.left;
    if (bb.right > right) right = bb.right;
    if (bb.top < top) top = bb.top;
    if (bb.bottom > bottom) bottom = bb.bottom;
  }
  return {
    left, right, top, bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}
void boxesBBox; // 保留以备后续同组操作
void bboxOf;

/** 对齐：返回与入参同序的新位置。少 1 个节点时直接返回空。 */
export function alignNodes(boxes: NodeBox[], kind: AlignKind): MindMapPosition[] {
  if (boxes.length < 2) return [];
  const group = boxesBBox(boxes);
  return boxes.map((b) => {
    switch (kind) {
      case 'left':
        return { x: group.left, y: b.y };
      case 'right':
        return { x: group.right - b.width, y: b.y };
      case 'center-h':
        return { x: group.cx - b.width / 2, y: b.y };
      case 'top':
        return { x: b.x, y: group.top };
      case 'bottom':
        return { x: b.x, y: group.bottom - b.height };
      case 'center-v':
        return { x: b.x, y: group.cy - b.height / 2 };
      default:
        return { x: b.x, y: b.y };
    }
  });
}

/** 等间距：把所选节点按指定轴等距分布，最外两个保持原位，剩余按间距均分。 */
export function distributeNodes(boxes: NodeBox[], kind: DistributeKind): MindMapPosition[] {
  if (boxes.length < 3) return [];
  // 沿目标轴按中心点排序
  const sorted = boxes
    .map((b, i) => ({ i, bb: bboxOf(b), box: b }))
    .sort((a, b) => (kind === 'horizontal' ? a.bb.cx - b.bb.cx : a.bb.cy - b.bb.cy));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = kind === 'horizontal' ? first.bb.cx : first.bb.cy;
  const end = kind === 'horizontal' ? last.bb.cx : last.bb.cy;
  const step = (end - start) / (sorted.length - 1);
  const out: MindMapPosition[] = new Array(boxes.length);
  for (let k = 0; k < sorted.length; k++) {
    const item = sorted[k];
    const targetCenter = start + step * k;
    if (kind === 'horizontal') {
      out[item.i] = { x: targetCenter - item.box.width / 2, y: item.box.y };
    } else {
      out[item.i] = { x: item.box.x, y: targetCenter - item.box.height / 2 };
    }
  }
  return out;
}
