export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ViewFamily =
  | 'structure-overview'
  | 'timeline'
  | 'relationship'
  | 'flow'
  | 'matrix'
  | 'charts';

export type MarkdownBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'table'
  | 'fenced-code'
  | 'blockquote'
  | 'frontmatter';

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  text: string;
  headingPath: string[];
  headingLevel?: number;
}

export interface SourceAnchor {
  excerpt: string;
  excerptHash: string;
  start: number;
  end: number;
  blockKind: MarkdownBlockKind;
  headingPath: string[];
}

export type AnchorResolution =
  | { status: 'valid'; anchor: SourceAnchor }
  | { status: 'relocated'; anchor: SourceAnchor }
  | { status: 'missing'; anchor: SourceAnchor }
  | { status: 'ambiguous'; anchor: SourceAnchor; matches: number };

export interface TraceableElement {
  id: string;
  kind: 'node' | 'edge' | 'event' | 'matrix-cell' | 'chart-point';
  label: string;
  anchor: SourceAnchor;
  data: Record<string, JsonValue>;
}

export interface VisualAnnotation {
  id: string;
  kind: 'node' | 'edge' | 'note' | 'group';
  label: string;
  data: Record<string, JsonValue>;
  boundAnchor?: SourceAnchor;
}

export interface ReviewItem {
  id: string;
  reason: 'incomplete' | 'inferred' | 'ambiguous' | 'unsupported';
  label: string;
  explanation: string;
  candidateAnchors: SourceAnchor[];
}

export interface VisualSheet {
  id: string;
  family: ViewFamily;
  templateId: string;
  name: string;
  elements: TraceableElement[];
  annotations: VisualAnnotation[];
  reviewItems: ReviewItem[];
  presentation: Record<string, Record<string, JsonValue>>;
  layout: Record<string, Record<string, JsonValue>>;
  createdAt: number;
  updatedAt: number;
  /** v4：模型在生成时给出的"图表观点"（一图一观点）；用户可见。 */
  mainView?: string;
  /** v3：模型在生成时给出的场景路由结论（scene_id + selection_reason），用户可见。 */
  routing?: { sceneId: string; selectionReason: string };
}

export interface VisualWorkbook {
  kind: 'folia.visual.workbook';
  schemaVersion: 1;
  rulesVersion: string;
  source: {
    relativePath: string;
    absolutePath?: string;
    contentHash: string;
  };
  title: string;
  recommendation?: {
    mode: 'direct' | 'choose';
    fits: ViewFit[];
  };
  sheets: VisualSheet[];
  activeSheetId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FitEvidence {
  code: string;
  label: string;
  count: number;
}

export interface ViewFit {
  family: ViewFamily;
  score: number;
  evidence: FitEvidence[];
  missing: string[];
  review: string[];
}

export interface ViewRecommendation {
  mode: 'direct' | 'choose';
  primary: ViewFit;
  candidates: ViewFit[];
}

export interface ViewEvaluator {
  family: ViewFamily;
  label: string;
  evaluate(blocks: MarkdownBlock[], source: string): ViewFit;
}
