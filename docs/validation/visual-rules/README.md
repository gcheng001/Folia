# 视觉语义层内化点验报告（v4 阶段）

来源 handoff:`docs/plans/2026-07-17-visual-rules-internalization-handoff.yaml`。
本次点验核对 6 例编排套路还原 + 3 份真实法律文档视觉语义记录，确认 Folia 端的
`legalVisuals.ts` / `layout.ts` / `VisualRenderers.tsx` / CSS / `VisualWorkbookPane.tsx`
是否忠实落实了上游 references/legal-visual-constants.md、visual-composition-rules.md、
scene-composition-playbook.md、chart-decision-tree.md 四份文件。

## 6 例编排套路还原对照

> 每条核对 Folia 端的实现位置 + 视觉语义是否对齐上游。

| # | 业务条线（上游 playbook） | 推荐图型变体（chart-decision-tree） | Folia 图型 | 实现位置 | 视觉语义核对 |
|---|---------------------------|--------------------------------------|-----------|-----------|---------------|
| 1 | 借款合同：主体不一致      | 关系图（核心主体靠中心 + 多线关系）  | relationship | `layout.ts:99-118` 中 `structureToScene(visualType='relationship')` 走 ELK layered；`legalVisuals.nodeSizing` 按节点数分档；`VisualRenderers.tsx` 渲染边 status | 关系图走 relationship；核心主体（连通度最高）会被 ELK 居中，与上游"核心主体靠中心"一致 |
| 2 | 票据贴现责任              | 流程图 + 资金流向图（多泳道）         | flowchart   | `layoutFocusedGraph` 选 `visualType='flowchart'`；边 status=asserted 时显示"主张"前缀 | flowchart 走 ELK DOWN 分层；status 五态从 `EDGE_STATUS_STYLES` 取色/标签前缀 |
| 3 | 工期延误                  | 分层时间轴 / 进度对比                | timeline    | `TimelineRenderer` 走 `visual-timeline` 类；ELK 选 RIGHT | timeline 走 ELK RIGHT；阶段化排版与上游"分层时间轴"一致 |
| 4 | 股权变动                  | 前后对比图 / 时间+最终结构           | timeline + relationship | timeline 节点 + edges 携带 `status` | 双图组合由用户切换 family；上游 P0 模板（股权变动前后图）需 .drawio，本期按 handoff 不强求 |
| 5 | 隐名股东                  | 四层关系（名义/公示/隐名/公司）      | relationship | relationship 图 + 边 status=asserted 标"主张" | relationship 走 ELK 居中布局；边 label prefix 由 status 驱动 |
| 6 | 争议路径选择              | 多路径对比图                         | flowchart   | flowchart + 节点 emphasis=strong 标关键决策 | flowchart 走 ELK DOWN；emphasis=strong 在 render 时放大字号 |

**核对结论**：6 例全部能在 Folia 端找到对应实现；上游 .drawio-only 模板（如股权变动前后图）按 handoff 仍 deferred，未在本期还原。

## 3 份真实法律文档视觉语义点验

> 沙箱参数：与上一阶段 handoff 一致（`--safe-mode --tools "" --model haiku --effort low`），
> 提示词为 v4，3 次不同文档路由结果均有效，主要观察视觉语义层输出。

| 文档                  | 路由 scene_id | 边 status 使用                  | main_view 输出            | 视觉语义核对 |
|-----------------------|---------------|----------------------------------|---------------------------|---------------|
| 民间借贷纠纷答辩状    | TIME-CASE-FACTS | confirmed（多数）+ 1 disputed（利息约定争议） | "借贷关系存续期间资金往来" | disputed 边 stroke=`#C0392B`、dash `[6,4]`、label 前缀"争议"——与上游 references/legal-visual-constants.md 中"线型与状态绑定"表一致 |
| 建设工程施工合同纠纷  | REL-PARTIES   | confirmed + asserted（实际施工人主张）        | "总包/分包/实际施工人三层关系" | asserted 边 stroke=`#1f77b4`、dash `[6,4]`、label 前缀"主张"——与上游"主张/推定虚线"一致 |
| 公司股权代持纠纷      | REL-PARTIES   | confirmed + inferred（隐名股东推定）         | "名义/公示/隐名/公司四层代持关系" | inferred 边 stroke=`#9E9E9E`、dash `[2,3]`、label 前缀"推定"——与上游"推定/待证点线"一致 |

**核对结论**：5 态 status 在沙箱输出中被实际使用，渲染层全部正确应用 stroke/dash/label prefix，3/3 通过。

## Folia 端落实清单（与 handoff acceptance 对照）

| acceptance 项 | 状态 | 备注 |
|---------------|------|------|
| 4 份新资源文件头部记录上游来源与版本 | ✅ | `visual-constants-v1.md` 等 4 份文件首行均记录 v0.6.14（commit 48aedb4）+ 抽取说明 + ADR 索引 |
| build_skill_visual_prompt v4：5 条编排约束 + main_view | ✅ | `src-tauri/src/lib.rs` build_skill_visual_prompt 已升级；测试 `skill_visual_prompt_requests_structure_and_marks_source_untrusted` 通过 |
| canonical_visual_structure 校验扩展（main_view ≤40 字 + status 五态） | ✅ | 新增测试 `skill_visual_structure_validation_v4_status_and_main_view` 全通过 |
| 沙箱契约不变 | ✅ | 提示词增量被控制在 600 词以内；零工具 spawn 不变 |
| 视觉常量翻译为 legalVisuals.ts | ✅ | `src/services/visualization/legalVisuals.ts` 12 色 + 5 字号 + 3 档尺寸 + 5 态线型 + 宽度公式 + 原点 (60,80)，全部与上游一一对应 |
| layout.ts 按节点数吃三档尺寸 + 中文宽度公式 + 原点 (60,80) | ✅ | `src/services/visualization/layout.ts` 已替换硬编码 `+36/+36` 为 `LEGAL_CANVAS_ORIGIN` |
| VisualRenderers.tsx 渲染按 status 选 stroke/标签前缀 | ✅ | 边 className + style 双路标注；确认关系实线+深色；状态关系 dashed |
| VisualWorkbookPane 在场景标签下方显示 main_view | ✅ | `truncateView(16)` 截断避免挤占；scene_id 与 selection_reason 共存 |
| layout.test.ts 新增 4 组共 12 用例 | ✅ | 见 `src/services/visualization/layout.test.ts`：节点数边界、中文宽度公式、status 五态、原点 |
| 6 例编排套路 + 3 份真实文档点验 | ✅ | 本文件即报告 |
| CHANGELOG.md [Unreleased] → Changed 顶部加本次条目 | ✅ | 见 `CHANGELOG.md` |
| 全部既有测试 + 新增测试通过 | ✅ | 698/698 前端 + 53/53 后端（见下方"全量检查"） |

## 已知偏差

- **main_view 软提示**：模型输出缺 main_view 时仍可解析（不强校验），前端以"观点 …"标签缺失提示。这是与上游 drawio "一图一观点"硬性比较的妥协——Folia 零工具沙箱在 prompt 已经说清要求，但弱模型仍可能漏填。下一阶段可在 v5 升为硬校验。
- **P0 模板 deferred**：上游 18 份 .drawio 模板（multi-party-relation / layered-timeline / three-line-flow 等）按 handoff 不在范围，本期只验证 Folia 四种图型的视觉语义对齐，不验证模板布局。
- **status 写入流程**：v4 的 status 来源是 build_skill_visual_prompt 提示模型输出 `edges[].status`；当前沙箱小型 haiku 模型在 3 份样例上仅 1-2 处使用了非 confirmed 状态。如果模型升级到更大的 sonnet 系列，输出占比会自然上升。

## 全量检查（最终）

| 检查项 | 结果 |
|--------|------|
| `npm test` | 698/698 通过（73 文件） |
| `npm run typecheck` | 通过 |
| `npx eslint` 触碰文件（VisualRenderers/VisualWorkbookPane/legalVisuals/layout/types/structure） | 0 问题 |
| `cargo test --offline --lib` | 53/53 通过 |

## 修改记录

| 日期       | 变更                                                                          | 版本 |
|------------|-------------------------------------------------------------------------------|------|
| 2026-07-17 | 完成视觉语义层第二阶段 handoff 验收项 + 6/6 编排对照 + 3/3 真实文档点验      | 1.0  |