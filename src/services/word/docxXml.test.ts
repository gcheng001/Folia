// ISS-171：本测试既要用 `node:fs` 读 fixture，又要在 docx 解析链路里用到
// `document.createElement`（style-mapping.ts 解析 HTML 表格）。两者冲突——
// vitest 的 jsdom 环境会把 `node:` 内置模块 externalize 报 "No such built-in
// module"。解法：用 node 环境（`node:fs` 原生可用），并用项目已装的 jsdom
// 依赖手动注入全局 `document` / `window`，满足 docx 解析对 DOM 的最小需求。
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

// 为 docx 解析链路提供最小 DOM。仅本文件作用域，不影响其他测试。
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as typeof globalThis & { document?: Document }).document = dom.window.document;
(globalThis as typeof globalThis & { window?: typeof dom.window }).window = dom.window;
(globalThis as typeof globalThis & { DOMParser?: typeof dom.window.DOMParser }).DOMParser =
  dom.window.DOMParser;
// `Node.TEXT_NODE` 等常量在 htmlTableModel.ts 里被直接引用，node 环境没有这些 DOM 常量。
(globalThis as typeof globalThis & { Node?: typeof dom.window.Node }).Node = dom.window.Node;
(globalThis as typeof globalThis & { Element?: typeof dom.window.Element }).Element =
  dom.window.Element;

import { DEFAULT_PRESET_ID, getPreset } from './config';
import { markdownToDocx } from './parser';
import type { PresetConfig } from './types';

async function readDocxZip(markdown: string, preset: PresetConfig = getPreset(DEFAULT_PRESET_ID)): Promise<JSZip> {
  const blob = await markdownToDocx(markdown, preset);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const text = await zip.file(path)?.async('string');
  if (!text) {
    throw new Error(`${path} not found in generated DOCX`);
  }
  return text;
}

async function optionalZipText(zip: JSZip, path: string): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

async function readDocumentXml(markdown: string, preset: PresetConfig = getPreset(DEFAULT_PRESET_ID)): Promise<string> {
  return readZipText(await readDocxZip(markdown, preset), 'word/document.xml');
}

async function readDocumentRelationships(markdown: string, preset: PresetConfig): Promise<{
  documentXml: string;
  headerXml?: string;
  footerXml?: string;
}> {
  const zip = await readDocxZip(markdown, preset);
  return {
    documentXml: await readZipText(zip, 'word/document.xml'),
    headerXml: await optionalZipText(zip, 'word/header1.xml'),
    footerXml: await optionalZipText(zip, 'word/footer1.xml'),
  };
}

function countXmlNodes(xml: string, nodeName: string): number {
  return xml.match(new RegExp(`<${nodeName}\\b`, 'g'))?.length ?? 0;
}

function xmlAttr(xml: string, tag: string, attr: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*${attr}="([^"]+)"`));
  return match?.[1];
}

function allXmlAttrs(xml: string, tag: string, attr: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*${attr}="([^"]+)"`, 'g'))].map((match) => match[1]);
}

/** 按 </w:p> 切分后找第一个文本包含 text 的段落（部分匹配，与 xmlParagraphContaining 的整段 <w:t> 精确匹配互补）。 */
function xmlParagraphWithText(xml: string, text: string): string {
  const paragraph = xml
    .split('</w:p>')
    .find((chunk) => chunk.replace(/<[^>]+>/g, '').includes(text));
  if (paragraph === undefined) {
    throw new Error(`Paragraph with text "${text}" not found`);
  }
  const start = paragraph.lastIndexOf('<w:p ') >= 0 ? paragraph.lastIndexOf('<w:p ') : paragraph.lastIndexOf('<w:p>');
  return `${paragraph.slice(Math.max(start, 0))}</w:p>`;
}

function xmlParagraphContaining(xml: string, text: string): string {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<w:p\\b[\\s\\S]*?<w:t[^>]*>${escapedText}</w:t>[\\s\\S]*?</w:p>`));
  if (!match) {
    throw new Error(`Paragraph containing "${text}" not found`);
  }
  return match[0];
}

describe('markdownToDocx XML output', () => {
  it('applies the legal preset heading and paragraph typography to DOCX XML', async () => {
    const documentXml = await readDocumentXml([
      '# 民事起诉状',
      '',
      '## 事实与理由',
      '',
      '原告围绕合同履行情况陈述如下。',
    ].join('\n'), getPreset('legal'));

    const titleParagraph = xmlParagraphContaining(documentXml, '民事起诉状');
    const subheadingParagraph = xmlParagraphContaining(documentXml, '事实与理由');
    const bodyParagraph = xmlParagraphContaining(documentXml, '原告围绕合同履行情况陈述如下。');

    expect(titleParagraph).toMatch(/<w:jc\b[^>]*w:val="center"/);
    expect(titleParagraph).toMatch(/<w:sz\b[^>]*w:val="44"/);
    expect(titleParagraph).toMatch(/<w:b\b/);
    expect(titleParagraph).toMatch(/<w:spacing\b[^>]*w:line="360"/);

    expect(subheadingParagraph).toMatch(/<w:sz\b[^>]*w:val="32"/);
    expect(subheadingParagraph).toMatch(/<w:b\b/);
    expect(subheadingParagraph).toMatch(/<w:ind\b[^>]*w:firstLine="560"/);
    expect(subheadingParagraph).toMatch(/<w:spacing\b[^>]*w:line="360"/);

    expect(bodyParagraph).toMatch(/<w:sz\b[^>]*w:val="28"/);
    expect(bodyParagraph).toMatch(/<w:ind\b[^>]*w:firstLine="560"/);
    expect(bodyParagraph).toMatch(/<w:spacing\b[^>]*w:line="360"/);
  });

  it('strips Markdown-only markers from the generated DOCX text', async () => {
    const documentXml = await readDocumentXml([
      '# 民事起诉状',
      '',
      '---',
      '',
      '- 第一项事实',
      '* 第二项事实',
    ].join('\n'), getPreset('legal'));

    expect(documentXml).toContain('民事起诉状');
    expect(documentXml).toContain('第一项事实');
    expect(documentXml).toContain('第二项事实');
    expect(documentXml).not.toContain('•');
    expect(documentXml).not.toContain('—');
    expect(documentXml).not.toContain('<w:t>#</w:t>');
    expect(documentXml).not.toContain('<w:t>-</w:t>');
    expect(documentXml).not.toContain('<w:t>*</w:t>');
  });

  it('preserves key merge and header nodes for legal HTML tables', async () => {
    const markdown = readFileSync(
      join(process.cwd(), 'fixtures', 'legal-html-tables', 'evidence-directory.md'),
      'utf8',
    );

    const documentXml = await readDocumentXml(markdown);

    expect(documentXml).toMatch(/<w:gridSpan\b[^>]*w:val="3"/);
    expect(documentXml).toMatch(/<w:vMerge\b[^>]*w:val="restart"/);
    expect(documentXml).toMatch(/<w:vMerge\b(?![^>]*w:val="restart")/);
    expect(countXmlNodes(documentXml, 'w:tblHeader')).toBe(2);
    expect(countXmlNodes(documentXml, 'w:tr')).toBeGreaterThanOrEqual(7);
  });

  it('applies extended table and header page-number preset values to DOCX XML', async () => {
    const base = getPreset(DEFAULT_PRESET_ID);
    const preset: PresetConfig = {
      ...base,
      page_number: {
        enabled: true,
        format: '1',
        font: 'Times New Roman',
        size: 10.5,
        position: 'header',
        align: 'right',
      },
      table: {
        ...base.table,
        border_enabled: false,
        alignment: 'center',
        vertical_align: 'bottom',
        cell_margins: {
          top: 40 / 567,
          bottom: 40 / 567,
          left: 60 / 567,
          right: 60 / 567,
        },
        header_background_color: '1E3A5F',
        row_odd_background_color: 'F5F0ED',
        row_even_background_color: 'FFFFFF',
      },
    };

    const { documentXml, headerXml, footerXml } = await readDocumentRelationships([
      '| 事项 | 说明 |',
      '| --- | --- |',
      '| 第一行 | 奇数背景 |',
      '| 第二行 | 偶数背景 |',
    ].join('\n'), preset);

    expect(headerXml).toBeDefined();
    expect(footerXml).toBeUndefined();
    expect(headerXml).toMatch(/<w:jc\b[^>]*w:val="right"/);
    expect(headerXml).toMatch(/<w:instrText\b[^>]*>\s*PAGE\s*<\/w:instrText>/);
    expect(headerXml).not.toMatch(/NUMPAGES/);

    expect(documentXml).toMatch(/<w:jc\b[^>]*w:val="center"/);
    expect(documentXml).toMatch(/<w:vAlign\b[^>]*w:val="bottom"/);
    expect(documentXml).toMatch(/<w:top\b[^>]*w:val="none"/);
    expect(documentXml).toMatch(/<w:bottom\b[^>]*w:val="none"/);
    expect(xmlAttr(documentXml, 'w:top', 'w:w')).toBe('40');
    expect(xmlAttr(documentXml, 'w:left', 'w:w')).toBe('60');
    expect(allXmlAttrs(documentXml, 'w:shd', 'w:fill')).toEqual(expect.arrayContaining([
      '1E3A5F',
      'F5F0ED',
      'FFFFFF',
    ]));
  });

  it('exports image captions when enabled and alt text exists', async () => {
    const base = getPreset(DEFAULT_PRESET_ID);
    const preset: PresetConfig = {
      ...base,
      image: {
        ...base.image,
        show_caption: true,
      },
    };

    const documentXml = await readDocumentXml('![证据图片](https://example.com/image.png)', preset);

    expect(documentXml).toContain('[图片: 证据图片]');
    expect(documentXml).toContain('证据图片');
  });

  it('applies reusable markdown and HTML style mappings to DOCX XML', async () => {
    const base = getPreset(DEFAULT_PRESET_ID);
    const preset: PresetConfig = {
      ...base,
      image: {
        ...base.image,
        show_caption: true,
      },
      styles: {
        mappedHeading: {
          font: '微软雅黑',
          ascii: 'Arial',
          size: 18,
          color: '445566',
          bold: true,
          align: 'right',
        },
        mappedParagraph: {
          font: '楷体',
          ascii: 'Georgia',
          size: 13,
          color: '112233',
          line_spacing: 1.8,
          first_line_indent: 1,
        },
        mappedTable: {
          table: {
            cell_margin: 40 / 567,
            header_background_color: 'ABCDEF',
            row_odd_background_color: 'F0F0F0',
          },
        },
        evidenceTable: {
          table: {
            header_background_color: '123456',
            row_odd_background_color: '654321',
            row_even_background_color: '654321',
          },
        },
        mappedCaption: {
          font: '黑体',
          ascii: 'Arial',
          size: 9,
          color: '777777',
        },
        mappedCode: {
          font: 'Courier New',
          ascii: 'Courier New',
          size: 11,
          color: '990000',
          left_indent: 18,
          line_spacing: 1.1,
        },
        mappedRule: {
          font: 'Arial',
          ascii: 'Arial',
          size: 8,
          color: '222222',
          bold: true,
          align: 'center',
        },
      },
      markdown_mapping: {
        heading1: 'mappedHeading',
        paragraph: 'mappedParagraph',
        table: 'mappedTable',
        image_caption: 'mappedCaption',
        code_block: 'mappedCode',
      },
      html_mapping: {
        selectors: {
          'table.evidence-table': 'evidenceTable',
        },
      },
    };

    const documentXml = await readDocumentXml([
      '# 映射标题',
      '',
      '映射正文',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '<table class="evidence-table"><tr><th>证据</th></tr><tr><td>合同</td></tr></table>',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '- 映射列表',
      '',
      '![证据图](https://example.com/evidence.png)',
    ].join('\n'), preset);

    expect(documentXml).toMatch(/<w:rFonts\b(?=[^>]*w:eastAsia="微软雅黑")(?=[^>]*w:ascii="Arial")/);
    expect(documentXml).toMatch(/<w:rFonts\b(?=[^>]*w:eastAsia="楷体")(?=[^>]*w:ascii="Georgia")/);
    expect(documentXml).toMatch(/<w:rFonts\b(?=[^>]*w:eastAsia="Courier New")(?=[^>]*w:ascii="Courier New")/);
    expect(allXmlAttrs(documentXml, 'w:color', 'w:val')).toEqual(expect.arrayContaining([
      '445566',
      '112233',
      '777777',
      '990000',
    ]));
    expect(allXmlAttrs(documentXml, 'w:shd', 'w:fill')).toEqual(expect.arrayContaining([
      'ABCDEF',
      'F0F0F0',
      '123456',
      '654321',
    ]));
    expect(allXmlAttrs(documentXml, 'w:top', 'w:w')).toEqual(expect.arrayContaining(['40']));
  });
});

// 用户法律文书常用格式（范本：延长调解期限申请书）：
// 此致正常缩进、法院名顶格、落款右对齐留签字空间、书信式抬头顶格。
describe('legal document layout (此致/顶格/落款)', () => {
  const 申请书 = [
    '# 延长调解期限申请书',
    '',
    '申请人：张某某',
    '',
    '申请事项：',
    '',
    '请求法院延长调解期限，延长期限为一个月。',
    '',
    '此致',
    '',
    '某某县人民法院',
    '',
    '申请人：',
    '',
    '二〇二六年七月十日',
  ].join('\n');

  it('uses 仿宋_GB2312 (not bare 仿宋) as eastAsia font everywhere in the legal preset', async () => {
    const documentXml = await readDocumentXml(申请书, getPreset('legal'));
    const eastAsiaFonts = allXmlAttrs(documentXml, 'w:rFonts', 'w:eastAsia');
    expect(eastAsiaFonts.length).toBeGreaterThan(0);
    expect([...new Set(eastAsiaFonts)]).toEqual(['仿宋_GB2312']);
  });

  it('keeps 此致 as a normal indented paragraph but removes first-line indent from the court name after it', async () => {
    const documentXml = await readDocumentXml(申请书, getPreset('legal'));

    const cizhiParagraph = xmlParagraphWithText(documentXml, '此致');
    expect(cizhiParagraph).toMatch(/<w:ind\b[^>]*w:firstLine="560"/);

    const courtParagraph = xmlParagraphWithText(documentXml, '某某县人民法院');
    expect(courtParagraph).not.toMatch(/<w:ind\b[^>]*w:firstLine=/);
  });

  it('right-aligns the closing signer line with signature space and the Chinese date line', async () => {
    const documentXml = await readDocumentXml(申请书, getPreset('legal'));

    // 落款"申请人："（此致之后的那个）右对齐，且冒号后保留全角空格作手写签字空间
    const closingChunk = documentXml.slice(documentXml.indexOf('此致'));
    const signerParagraph = xmlParagraphWithText(closingChunk, '申请人：');
    expect(signerParagraph).toMatch(/<w:jc\b[^>]*w:val="right"/);
    expect(signerParagraph).toMatch(/申请人：　/);

    const dateParagraph = xmlParagraphWithText(documentXml, '二〇二六年七月十日');
    expect(dateParagraph).toMatch(/<w:jc\b[^>]*w:val="right"/);
    expect(dateParagraph).not.toMatch(/<w:ind\b[^>]*w:firstLine=/);
  });

  it('does not right-align 申请人 lines in the document head (before 此致)', async () => {
    const documentXml = await readDocumentXml(申请书, getPreset('legal'));
    const headSigner = xmlParagraphWithText(documentXml, '申请人：张某某');
    expect(headSigner).not.toMatch(/<w:jc\b[^>]*w:val="right"/);
    expect(headSigner).toMatch(/<w:ind\b[^>]*w:firstLine="560"/);
  });

  it('letter-style head 致某某单位 is flush left while following body keeps first-line indent', async () => {
    const documentXml = await readDocumentXml([
      '致某某市中级人民法院：',
      '',
      '现就贵院受理的合同纠纷一案陈述意见如下。',
    ].join('\n'), getPreset('legal'));

    const headParagraph = xmlParagraphWithText(documentXml, '致某某市中级人民法院：');
    expect(headParagraph).not.toMatch(/<w:ind\b[^>]*w:firstLine=/);

    const bodyParagraph = xmlParagraphWithText(documentXml, '现就贵院受理的合同纠纷一案陈述意见如下。');
    expect(bodyParagraph).toMatch(/<w:ind\b[^>]*w:firstLine="560"/);
  });

  it('Arabic-digit date in closing is also right-aligned', async () => {
    const documentXml = await readDocumentXml([
      '此致',
      '',
      '某某人民法院',
      '',
      '2026年7月10日',
    ].join('\n'), getPreset('legal'));

    const dateParagraph = xmlParagraphWithText(documentXml, '2026年7月10日');
    expect(dateParagraph).toMatch(/<w:jc\b[^>]*w:val="right"/);
  });
});
