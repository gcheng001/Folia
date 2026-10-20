export type DiagramTextStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  lineHeight?: number;
};

export type TextMeasurer = (text: string, style: DiagramTextStyle) => number;

let measureCanvas: HTMLCanvasElement | undefined;

function isWideCharacter(char: string): boolean {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(char);
}

/** jsdom/无 Canvas 时的确定性后备；真实应用优先使用 Canvas measureText。 */
export const fallbackTextMeasurer: TextMeasurer = (text, style) => Array.from(text).reduce((width, char) => {
  if (/\s/u.test(char)) return width + style.fontSize * 0.33;
  return width + style.fontSize * (isWideCharacter(char) ? 1 : 0.58);
}, 0);

export const browserTextMeasurer: TextMeasurer = (text, style) => {
  if (typeof document === 'undefined') return fallbackTextMeasurer(text, style);
  if (typeof navigator !== 'undefined' && /jsdom/iu.test(navigator.userAgent)) return fallbackTextMeasurer(text, style);
  measureCanvas ??= document.createElement('canvas');
  const context = measureCanvas.getContext('2d');
  if (!context) return fallbackTextMeasurer(text, style);
  context.font = `${style.fontWeight ?? 400} ${style.fontSize}px ${style.fontFamily}`;
  const measured = context.measureText(text).width;
  return Number.isFinite(measured) && measured > 0 ? measured : fallbackTextMeasurer(text, style);
};

export type WrappedText = {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
};

export function wrapText(
  text: string,
  maxWidth: number,
  style: DiagramTextStyle,
  measure: TextMeasurer = browserTextMeasurer,
): WrappedText {
  const safeMaxWidth = Math.max(style.fontSize, maxWidth);
  const lines: string[] = [];

  for (const paragraph of text.replace(/\r\n?/gu, '\n').split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const char of Array.from(paragraph)) {
      const candidate = `${current}${char}`;
      if (current && measure(candidate, style) > safeMaxWidth) {
        lines.push(current.trimEnd());
        current = char.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current || '');
  }

  const lineHeight = style.lineHeight ?? style.fontSize * 1.45;
  return {
    lines: lines.length > 0 ? lines : [''],
    width: Math.min(safeMaxWidth, Math.max(0, ...lines.map((line) => measure(line, style)))),
    height: Math.max(lineHeight, lines.length * lineHeight),
    lineHeight,
  };
}
