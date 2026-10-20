export const SKILL_VISUAL_TYPES = ['flowchart', 'timeline', 'relationship', 'mindmap'] as const;
export const SKILL_VISUAL_STYLES = ['light-formal', 'business', 'dark-tech', 'soft-color'] as const;

export type SkillVisualType = typeof SKILL_VISUAL_TYPES[number];
export type SkillVisualStyle = typeof SKILL_VISUAL_STYLES[number];
export type SkillVisualStage = 'preparing' | 'analyzing' | 'drawing' | 'validating' | 'saving';

const STYLE_STORAGE_KEY = 'folia.skillVisual.documentStyles.v1';

function occurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

/**
 * 给出一个可被用户覆盖的默认类型。规则有意保持透明、稳定，不把推荐冒充成事实判断。
 */
export function recommendSkillVisualType(markdown: string): SkillVisualType {
  const dateScore = occurrences(
    markdown,
    /(?:\d{4}[年./-]\d{1,2}(?:[月./-]\d{1,2}日?)?|\d{1,2}月\d{1,2}日|(?:今日|次日|随后|之后|此前))/g,
  );
  if (dateScore >= 2) return 'timeline';

  const relationshipScore = occurrences(
    markdown,
    /(?:关系|主体|当事人|原告|被告|证人|股东|关联|隶属|控制|持有|证据链|人物)/g,
  );
  if (relationshipScore >= 3) return 'relationship';

  const flowScore = occurrences(
    markdown,
    /(?:流程|程序|步骤|申请|受理|审查|审批|执行|提交|处理|进入|完成|驳回|通过)/g,
  );
  if (flowScore >= 3) return 'flowchart';

  return 'mindmap';
}

function readStoredStyles(): Record<string, SkillVisualStyle> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, SkillVisualStyle] =>
        SKILL_VISUAL_STYLES.includes(entry[1] as SkillVisualStyle)),
    );
  } catch {
    return {};
  }
}

/** 未保存文档没有稳定身份，因此始终返回浅色正式，也不继承其他文档的选择。 */
export function getDocumentSkillVisualStyle(path: string): SkillVisualStyle {
  if (!path) return 'light-formal';
  return readStoredStyles()[path] ?? 'light-formal';
}

export function rememberDocumentSkillVisualStyle(path: string, style: SkillVisualStyle): void {
  if (!path) return;
  try {
    const styles = readStoredStyles();
    styles[path] = style;
    localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(styles));
  } catch {
    // localStorage 被禁用时只失去“记住风格”，不影响生成。
  }
}

export function createSkillVisualJobId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '')
    : Math.random().toString(36).slice(2);
  return `skill_${Date.now().toString(36)}_${random}`;
}
