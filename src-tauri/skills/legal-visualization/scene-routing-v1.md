# Folia 内置法律场景路由知识 v1

来源：`cat-xierluo/legal-skills` 的 `legal-visualization`，上游版本 `v0.6.14`，核对提交
`f41fa158a4a22346793688169e31de07bdd109f4`。本文件内化上游 `SKILL.md` 场景路由速查、
`references/scene-routing-guide.md` 与 `references/chart-decision-tree.md` 的路由精要，
并把场景收敛到 Folia 支持的四种图类型；不读取或执行用户机器上安装的任何 Skill。
上游许可证为 CC-BY-NC（见 `THIRD_PARTY_LICENSES/legal-skills-CC-BY-NC.txt`），
Folia 与上游为同一作者授权复用，决策记录见 `docs/adr/0022-internalize-legal-visualization-knowledge.md`。

姊妹资源(同次 handoff 落地,v0.6.14)：

- `visual-constants-v1.md` —— 调色板、字体、节点尺寸、状态线型。
- `composition-rules-v1.md` —— 一图一观点、颜色含义、缺失事实显式标注、3S 精简。
- `chart-decision-tree-v1.md` —— scene_id 选定后落地到 Folia 四种图型的决策表。
- `composition-playbook-v1.md` —— 按图型给模型的编排套路与常见失败。

## 目标

在生成图表结构 JSON 之前，先在下方场景库内完成一次路由：判断文档最该画成哪一个
法律场景，再按该场景对应的图类型组织节点与连线。路由结论必须写入输出 JSON 的
`routing` 字段（`scene_id` + `selection_reason`），供用户核对选型理由。

## 路由顺序

按以下顺序判断，前一条能定论时不再往下看：

1. **用户明确指定**：用户点名"时间轴、流程图、关系图、脑图"等图形时，优先尊重指定；
   只有明显不适合材料时才调整，并在 selection_reason 中说明。
2. **受众**：给法官/仲裁庭的图优先案件事实、争点、证据、法律关系；给客户的图优先
   路径、风险、方案、配合事项；给业务/律师团队的图优先流程、责任、任务。
3. **任务动词**：说明、证明、反驳 → 关系/时间类；选择、推进、交付、整改 → 流程类；
   梳理、拆解、盘点、汇报全貌 → 脑图类。
4. **材料阶段**：咨询/报价/委托、办案/庭审/执行、证据/文书、交易/合规分别指向不同场景。
5. **信息形态**：时间先后 → timeline；主体与关系 → relationship；步骤与分支 → flowchart；
   分类与层级 → mindmap。

评分要点（并列时的取舍）：受众匹配 > 任务动词匹配 > 更窄业务领域 > 材料阶段 >
通用兜底场景。场景需要材料中没有的关键事实、或会把争议事实画成确定事实的，直接排除。

## 场景库

scene_id 必须从下表中选取，每个 scene_id 只对应一种图类型。材料匹配不到具体业务
场景时，选该图类型的 `*-GENERIC` 兜底场景。

### flowchart（流程图）

| scene_id | 场景 | 适用输入特征 |
|---|---|---|
| FLOW-LITIGATION | 案件办理/程序推进路线 | 诉前评估、起诉准备、庭审、执行推进等单一案件阶段流程 |
| FLOW-CONTRACT | 合同流程与履约闭环 | 合同起草审查、审批流转、履约管理、违约处置、收付款验收 |
| FLOW-COMPLIANCE | 合规整改与治理闭环 | 监管检查整改、内控缺陷闭环、合规审批流程、制度落地步骤 |
| FLOW-DISPUTE-PATH | 争议解决路径选择 | 谈判/调解/仲裁/诉讼多路径比较、制度路径分支、决策分叉 |
| FLOW-GENERIC | 通用流程 | 有明确先后步骤或判断分支，但不属于以上业务条线 |

### timeline（时间轴）

| scene_id | 场景 | 适用输入特征 |
|---|---|---|
| TIME-CASE-FACTS | 案件事实时间轴 | 案件事件先后经过、多主体行为按时间排列 |
| TIME-PERFORMANCE | 履约与工期时间轴 | 双方履约义务对照、工期进度与延误、项目里程碑 |
| TIME-PROCEDURE | 程序与期间时间轴 | 诉讼时效、保证期间、程序节点期限、审理进程 |
| TIME-VERSION | 版本与变动时间轴 | 文书多轮修改、股权多次变动、制度沿革等按时间演变 |
| TIME-GENERIC | 通用时间轴 | 以时间先后为主线，但不属于以上业务条线 |

### relationship（关系图）

| scene_id | 场景 | 适用输入特征 |
|---|---|---|
| REL-PARTIES | 多主体法律关系 | 多主体、多合同、名义/实际主体不一致、资金/货物/票据流转 |
| REL-EQUITY | 股权与控制结构 | 股权结构、间接持股、隐名股东、实际控制路径、公司治理层级 |
| REL-TRANSACTION | 交易架构 | 投融资并购中主体、标的、对价、控制权变化的结构安排 |
| REL-EVIDENCE | 证据链与证明关系 | 证据指向待证事实、间接证据组合、证明责任分布 |
| REL-GENERIC | 通用关系图 | 以主体间关系为主线，但不属于以上业务条线 |

### mindmap（脑图）

| scene_id | 场景 | 适用输入特征 |
|---|---|---|
| MIND-ISSUES | 争点与问题拆解 | 争点分解、尽调问题分布、案件问题诊断的分类展开 |
| MIND-RISK | 风险盘点地图 | 合规风险地图、条款风险分级、多业务模块风险汇总 |
| MIND-SCOPE | 服务范围与交付物 | 法律服务方案、工作范围、交付物清单、报价结构 |
| MIND-CLAUSES | 条款与文书结构 | 合同条款体系、文书章节结构、制度体系分层 |
| MIND-GENERIC | 通用脑图 | 以分类/层级展开为主线，但不属于以上业务条线 |

## 冲突处理

| 冲突 | 优先规则 |
|---|---|
| FLOW-LITIGATION vs FLOW-DISPUTE-PATH | 单一案件从接案到执行的推进选 FLOW-LITIGATION；多条解决路径比较选 FLOW-DISPUTE-PATH |
| FLOW-LITIGATION vs REL-EVIDENCE | 案件推进主线选 FLOW-LITIGATION；证据如何证明争点是主问题时选 REL-EVIDENCE |
| FLOW-CONTRACT vs REL-TRANSACTION | 合同管理和履约闭环选 FLOW-CONTRACT；交易架构、交割安排选 REL-TRANSACTION |
| FLOW-COMPLIANCE vs MIND-RISK | 有明确整改/审批步骤选 FLOW-COMPLIANCE；只做风险分布盘点选 MIND-RISK |
| TIME-CASE-FACTS vs REL-PARTIES | 时序是核心争点选 TIME-CASE-FACTS；主体与合同关系是核心争点选 REL-PARTIES |
| TIME-VERSION vs FLOW-CONTRACT | 展示某份文书/结构的版本演变选 TIME-VERSION；展示生产审批流程选 FLOW-CONTRACT |
| MIND-SCOPE vs FLOW-LITIGATION | 报价、服务价值、交付范围选 MIND-SCOPE；案件如何推进选 FLOW-LITIGATION |
| MIND-ISSUES vs REL-EVIDENCE | 拆解问题/争点分类选 MIND-ISSUES；表达证据对事实的证明方向选 REL-EVIDENCE |
| 专题 vs GENERIC | 专题场景能命中时不用 GENERIC；GENERIC 只在没有明确业务条线时兜底 |

## 路由输出要求

- `routing.scene_id`：必须是上表中的一个 scene_id，且其所属图类型必须与本次要求的
  图类型一致（例如要求生成时间轴时只能选 TIME-* 场景）。
- `routing.selection_reason`：一句话（不超过 60 字）说明为什么该场景最匹配材料，
  可提及被排除的相近场景。
- 一图一观点：材料同时涉及关系、时间、流程时，路由只回答"当前要求的图类型下，
  哪个场景最能表达核心观点"，不要试图把所有信息塞进一张图。
- 材料中未出现的主体、时间、金额、证据不得进入节点；确有必要占位时标注"待补充"。
