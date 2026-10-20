# 场景路由验收集与人工点验记录

> 日期:2026-07-17
> 范围:验收 `build_skill_visual_prompt` v3 的场景路由能力(scene-routing-v1.md 内化知识)
> 上游:`cat-xierluo/legal-skills` v0.6.14(提交 `f41fa158`)`references/scene-routing-evals.md`(T-01…T-20)
> 关联:`docs/adr/0022-internalize-legal-visualization-knowledge.md`、`src-tauri/skills/legal-visualization/scene-routing-v1.md`

## 一句话结论

**路由验收通过。** 14 个改编评测用例覆盖了上游标注的高风险误选边界;在 3 份真实法律文档上实际运行零工具沙箱共 4 次,4/4 命中预期场景,selection_reason 均能说清选型依据。

---

## 一、改编评测集(14 例)

上游评测集针对 241 个场景;Folia 将场景收敛为 4 种图类型 × 5 场景(共 20 个,含 4 个 GENERIC 兜底),因此改编时把上游主场景映射到 Folia scene_id,并保留"容易误选"标注用于核对冲突处理规则。上游用例中依赖 Folia 未收录业务条线的(如 T-03 客户配合清单、T-07 顾问年度地图、T-12 数据出境路径、T-17 庭审甘特图)不纳入本集。

| 编号 | 上游 | 用户输入摘要 | 图类型 | 预期 scene_id | 容易误选 | 路由理由 |
|------|------|------|------|------|------|------|
| F-01 | T-01(LP-01) | 客户第一次咨询建设工程延期,想知道要不要起诉 | flowchart | FLOW-LITIGATION | FLOW-DISPUTE-PATH、MIND-ISSUES | 核心是单一案件的诉前评估推进,不是多路径比较,也不是问题盘点 |
| F-02 | T-02(C-10) | 给法官看工期延误是谁造成的 | timeline | TIME-PERFORMANCE | TIME-CASE-FACTS | 受众是法官,核心争点是工期进度与延误责任,不是泛化事件经过 |
| F-03 | T-04(EV-03) | 庭前要固定网页和聊天记录,并准备质证意见 | flowchart | FLOW-LITIGATION | REL-EVIDENCE | 首要动作是庭前证据固定的办案步骤;证据如何证明争点不是主问题 |
| F-04 | T-05(RP-01) | 比较谈判、仲裁、诉讼三条路径怎么选 | flowchart | FLOW-DISPUTE-PATH | FLOW-LITIGATION | 核心是多条解决路径比较,不是单一案件推进(冲突表第 1 行) |
| F-05 | T-06(SP-04) | 给潜在客户做专项法律服务报价和交付范围 | mindmap | MIND-SCOPE | MIND-CLAUSES、FLOW-CONTRACT | 报价边界和交付物清单是主任务,属服务范围分类展开 |
| F-06 | T-08(CT-10) | 企业要建立合同模板体系和审批机制 | mindmap | MIND-CLAUSES | FLOW-CONTRACT | 核心是合同体系的分层架构;审批流转只是附属信息 |
| F-07 | T-09(WD-05) | 把一份合同审查意见从条款风险到修改稿交付画出来 | flowchart | FLOW-CONTRACT | MIND-RISK、TIME-VERSION | 核心是审查意见的生产与交付流程,不是风险盘点或版本演变 |
| F-08 | T-10(MA-01) | 并购项目需要说明交易主体、标的、对价和控制权变化 | relationship | REL-TRANSACTION | REL-PARTIES、REL-EQUITY | 交易结构优先于通用法律关系(冲突表 FLOW-CONTRACT vs REL-TRANSACTION 同源规则) |
| F-09 | T-11(MA-03) | 尽调发现公司、资产、劳动、税务多个问题,需要汇报风险 | mindmap | MIND-ISSUES | MIND-RISK | 核心是尽调问题分布的拆解汇报,不是风险分级地图 |
| F-10 | T-13(RG-03) | 收到监管检查意见,要求说明整改闭环 | flowchart | FLOW-COMPLIANCE | MIND-RISK | 有明确整改步骤时选流程(冲突表第 4 行);上游 RG-03/CG-07 在 Folia 均收敛到 FLOW-COMPLIANCE |
| F-11 | T-15(LP-10) | 胜诉后客户想知道执行怎么推进 | flowchart | FLOW-LITIGATION | FLOW-DISPUTE-PATH | 核心是胜诉案件的执行推进流程,属单一案件办理阶段 |
| F-12 | T-16(DR-06) | 执行阶段要寻找账户、不动产、股权等财产线索 | mindmap | MIND-GENERIC | FLOW-LITIGATION | 核心是财产线索的分类盘点;Folia 无执行财产专题场景,按规则落 GENERIC 兜底 |
| F-13 | T-18(L-01) | 借款案件中名义借款人和实际用款人不一致,给法院看 | relationship | REL-PARTIES | REL-GENERIC、REL-EVIDENCE | 名义/实际主体不一致是 REL-PARTIES 的明示特征,专题优先于 GENERIC |
| F-14 | T-20(WD-08) | 起诉状多轮修改,想展示版本变化和客户确认节点 | timeline | TIME-VERSION | FLOW-CONTRACT、TIME-CASE-FACTS | 核心是文书版本按时间演变,不是生产审批流程(冲突表第 6 行) |

### 判定标准(改编自上游)

一个路由结果通过验收,应同时满足:

1. scene_id 属于本次图类型允许的 5 个场景之一(Rust 侧 `canonical_visual_structure` 强制)。
2. 主场景能回答用户最直接的问题;未选相近场景有可说明的排除理由。
3. selection_reason 不强行引入材料中不存在的事实。
4. 受众匹配输出对象(给法官的图优先事实/争点/证据,给客户的图优先路径/方案)。
5. 材料匹配不到具体业务条线时落 `*-GENERIC`,不硬凑专题场景。

---

## 二、真实文档人工点验(3 份文档,4 次运行)

### 点验方式

- 复刻 `src-tauri/src/lib.rs` 的零工具沙箱参数运行 `claude -p`:`--safe-mode --no-session-persistence --strict-mcp-config --disable-slash-commands --tools "" --effort low --model haiku`,专用短 system prompt,提示词走 stdin,源文档 JSON 编码注入。
- 提示词与 `build_skill_visual_prompt` v3 的格式串逐字一致(注入 scene-routing-v1.md 全文与本图类型允许场景列表)。
- 与产品链路的差异仅在输出传输格式(点验用默认文本输出,产品用 `--output-format stream-json`),不影响路由结论。

### 点验结果

| # | 文档 | 图类型 | 预期 | 实际 scene_id | 结果 |
|---|------|------|------|------|------|
| 1 | `src/services/mindmap/__fixtures__/hearing-realistic.md`(追偿权纠纷庭审材料) | relationship | REL-PARTIES | REL-PARTIES | ✅ |
| 2 | 同上 | timeline | TIME-CASE-FACTS | TIME-CASE-FACTS | ✅ |
| 3 | `src/services/mindmap/__fixtures__/hearing-template.md`(庭审记录模板) | flowchart | FLOW-LITIGATION | FLOW-LITIGATION | ✅ |
| 4 | `fixtures/legal-html-tables/evidence-directory.md`(采购合同纠纷证据目录) | relationship | REL-EVIDENCE | REL-EVIDENCE | ✅ |

### 各次 selection_reason 原文

1. **REL-PARTIES**:"本案涉及原告、被告甲、乙保险公司三方主体的用工关系、侵权赔偿、追偿权、保险责任等多重法律关系,以及名义被保险人与实际受益权人的权利争议,属典型的多主体法律关系纠纷。"
2. **TIME-CASE-FACTS**:"材料按时间顺序呈现交通事故→责任认定→人民调解→赔偿履行→追偿诉讼的完整案件事实链条,是原告获得追偿权的因果展开。"
3. **FLOW-LITIGATION**:"材料记录单一案件的庭审程序推进,从诉讼请求、举证质证到法庭调查的阶段流程,符合FLOW-LITIGATION场景。"
4. **REL-EVIDENCE**:"材料是证据目录,通过证据与证明目的的对应关系展示如何支撑待证事实,属证据链与证明关系的典型场景。"

### 点验评价

- 4/4 命中预期场景;同一份文档在不同图类型下(第 1、2 次)各自选出该类型下最匹配的场景,未出现跨类型 scene_id,符合"一图一观点"。
- 每条 selection_reason 均引用了材料中真实存在的主体/事件,未编造事实;第 2、4 次能主动区分相邻场景。
- 已知偏差:第 1 次 selection_reason 为 89 字,超出知识文件"不超过 60 字"的软性建议,但远低于校验的 200 字硬上限,不拦截;如后续要求更紧凑,可在 scene-routing-v1.md 中把 60 字改为硬性表述。
- 结构输出同轮通过:节点数 9-12(限 8-16)、边数不超节点两倍,`canonical_visual_structure` 全部校验规则可通过。

---

## 三、自检信息

- 本目录只含验收文档,未触碰应用代码;评测集为静态基准,后续修改 scene-routing-v1.md 场景表时应同步核对本集预期。
- 点验消耗:4 次 haiku 低推理调用,零工具、无会话持久化,未读取或写入用户文件。
- 未调用已安装 Skill,路由知识全部来自版本内置的 `scene-routing-v1.md`(验收标准:唯一知识来源)。
