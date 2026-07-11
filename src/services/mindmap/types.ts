/**
 * 脑图领域模型（MD 即源）。纯数据，零 React 依赖。
 *
 * 设计要点见 docs/plans/2026-07-11-mindmap-view-design.md 第 3 节。
 *
 * 往返不变式：对未经画布编辑的文档，serialize(parse(md)) === md。
 * 实现上靠「每个节点记录自己的原文行号 + 原文行数组」，序列化时
 * 按文档序（先序 DFS）原样拼回，不重建文本。
 */

/** 固定词表的节点类型（行内 #要件 等识别而来）。 */
export type NodeType = '要件' | '争点' | '证据' | '法条' | '事实' | '质证';

/** 节点种类：根 / 标题 / 列表项。 */
export type NodeKind = 'root' | 'heading' | 'list';

/** Obsidian wiki 引用：[[target]] 或 [[target#anchor]]。 */
export interface WikiRef {
  target: string;
  anchor?: string;
}

/** 质证三性认可状态词表。命中才记录，否则原样留作节点文本。 */
export type EvidenceVerdict = '认可' | '不认可' | '部分认可';

/** 三性状态。 */
export interface EvidenceStatus {
  真实性?: EvidenceVerdict;
  合法性?: EvidenceVerdict;
  关联性?: EvidenceVerdict;
}

export interface MindNode {
  /** 稳定 id：从根到本节点的文本路径，用于布局 sidecar 匹配。 */
  id: string;
  kind: NodeKind;
  /** outline 深度：标题为 1-6，列表项为相对深度，虚拟根为 0。 */
  level: number;
  /** 显示文本（标题/列表项原文行内文本，原样含 #tag 与 [[link]]）。 */
  text: string;
  children: MindNode[];
  // —— 领域字段（3.3，非破坏性抽取；text 不变，往返不受影响）——
  types: NodeType[];
  tags: string[];
  refs: WikiRef[];
  /** 本文件内关联线目标锚（来自 [[#anchor]]）。 */
  links: string[];
  evidence?: EvidenceStatus;
  /** 本节点 outline 行在原文 lines 中的下标（虚拟根为 -1）。 */
  lineIndex: number;
}

export interface MindMapDoc {
  /** 根节点。单个 H1 时即该 H1；否则为文件名虚拟根（text 为空串）。 */
  root: MindNode;
  /** 原文行数组（CST）。序列化的唯一来源，编辑前原样、编辑后局部替换。 */
  lines: string[];
}
