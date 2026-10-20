import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSkillVisualJobId,
  getDocumentSkillVisualStyle,
  recommendSkillVisualType,
  rememberDocumentSkillVisualStyle,
} from './skillVisualService';

describe('skillVisualService', () => {
  beforeEach(() => localStorage.clear());

  it('recommends a timeline when the document contains several dates', () => {
    expect(recommendSkillVisualType('2025年1月1日签约。2025年3月2日付款。')).toBe('timeline');
  });

  it('recommends relationship and flow views from explicit document signals', () => {
    expect(recommendSkillVisualType('原告与被告关系复杂，另有证人和关联公司。')).toBe('relationship');
    expect(recommendSkillVisualType('申请后提交材料，受理并审查，最后完成审批。')).toBe('flowchart');
  });

  it('falls back to a mind map for general structured notes', () => {
    expect(recommendSkillVisualType('# 产品方案\n## 目标\n## 风险')).toBe('mindmap');
  });

  it('remembers styles per saved document and defaults drafts to light formal', () => {
    rememberDocumentSkillVisualStyle('/tmp/a.md', 'dark-tech');
    rememberDocumentSkillVisualStyle('/tmp/b.md', 'business');
    expect(getDocumentSkillVisualStyle('/tmp/a.md')).toBe('dark-tech');
    expect(getDocumentSkillVisualStyle('/tmp/b.md')).toBe('business');
    expect(getDocumentSkillVisualStyle('/tmp/c.md')).toBe('light-formal');
    expect(getDocumentSkillVisualStyle('')).toBe('light-formal');
  });

  it('creates a Rust-safe task id', () => {
    expect(createSkillVisualJobId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
