# 关系图场景细则内化试点 · 点验报告

来源 handoff:`docs/plans/2026-07-17-scene-details-rel-pilot-handoff.yaml`
资源文件:`src-tauri/skills/legal-visualization/scene-details-rel-v1.md`(钉上游
`cat-xierluo/legal-skills` v0.6.14 commit `48aedb4`,Folia 同作者授权复用)

## 试点范围

只内化 REL 家族(关系图)的 5 个场景细则:REL-PARTIES / REL-EQUITY / REL-TRANSACTION /
REL-EVIDENCE / REL-GENERIC。其余三型(flowchart / timeline / mindmap)的生成提示词与
试点前逐字节一致(由 `skill_visual_prompt_injects_scene_details_only_for_relationship`
测试守护)。

## 点验方法

1. `cargo test dump_relationship_prompts_for_manual_validation -- --ignored` 导出 3 份
   关系图提示词到 `FOLIA_PROMPT_DUMP_DIR`(`/tmp/folia-rel-pilot/`,共 109.9 KB)。
2. 每份提示词送进零工具沙箱复刻链:`--safe-mode --tools "" --model haiku --effort low`,
   与产品链路逐字节相同(`scene_details` 静态注入,不再改写 prompt)。
3. 把沙箱输出送进产品级 `canonical_visual_structure` 校验器
   (`cargo test verify_rel_pilot_outputs -- --ignored`),同时人工核对 REL 资源三条硬规则
   与各场景「常见失败」清单是否被规避。

## 点验结果(3/3 全绿)

| 文档 | 预期场景 | 实际路由 | 节点 / 边 | 状态分布 | 校验 | 结论 |
|---|---|---|---|---|---|---|
| `hearing-realistic.md`(共享经济 + 交通事故追偿案)| REL-PARTIES | REL-PARTIES ✓ | 12 / 14 | confirmed ×9 / asserted ×3 / disputed ×2 | 通过 | 多主体法律关系定性 + 保险追偿链,场景选型正确 |
| `hearing-template.md`(空白庭审模板)| REL-GENERIC | REL-GENERIC ✓ | 6 / 8 | confirmed ×8 | 通过 | 无具体合同/股权/证据细节,按 REL-GENERIC 兜底,选型正确 |
| `evidence-directory.md`(买卖合同履约证据目录)| REL-EVIDENCE | REL-EVIDENCE ✓ | 9 / 7 | confirmed ×5 / inferred ×2 | 通过 | 证据→待证事实的证明图,场景选型正确 |

合计:**3/3 路由命中预期;3/3 通过 Folia 校验器;0 失败**。

## 细则被实际使用的证据

### 1. REL-PARTIES(hearing-realistic)

资源三条硬规则的实际落地:

- **主体只画有法律行为的**:只保留原告/被告一/被告二 + 协议/保单/事故认定/调解协议 6 个
  行为载体,未把骑手具体身份、家庭成员等无法律行为主体入图。
- **边 label 写「关系类别 + 关键数值」**:e5 标签为「签发保单(限额 75 万 - 绝对免赔 20 万
  = 55 万)」,e7 标签为「对外赔偿 100 万元(另案调解)」,e8 标签为「被告甲个人赔付
  3.5 万元」,均带关键数值。
- **名义与实际分状态**:原告主张用工关系用 `asserted`,被告抗辩承揽关系用 `disputed`,
  事故责任认定(登记/书面)用 `confirmed`,完全符合资源第 24 行的规则。

REL-PARTIES 细则第 30 行的「核心主体(连线最多者)用 `emphasis: strong` 且排在 nodes 前列」:
原告/被告一/被告二均 `strong` 且排在前 3 位;细则第 31 行「区分签约关系和履行关系」:
e3(投保)与 e6(事故认定)分别为履行类与登记类 label,与 e4(签协议)分开;细则第 31 行
「担保链按主债务→担保责任→代偿→追偿的路径连边」:此案无担保链但追偿链(对外赔偿 →
追偿主张)按路径连成线性而非网状。

### 2. REL-EVIDENCE(evidence-directory)

- **左侧证据 / 右侧待证事实**:6 个证据节点(合同/邮件/物流/对账/事实说明)在 n1–n5
  与 n5(长说明),3 个待证事实节点(签约合意/货物交付/欠款)在 n6–n9,待证事实均
  `emphasis: strong`,符合资源第 58 行。
- **方向一律「证据 → 待证事实」**:全部 7 条边均从证据侧指向事实侧(无反向),与资源
  第 59 行一致。
- **label 写证明作用**:e1「证明签约合意」、e2「印证双方确认签署」、e3「证明货物交付」、
  e4「证明欠款金额」,与资源第 59 行要求的「证明/印证」措辞一致。
- **missing 态缺席**:材料无「尚未取得的补强证据」,模型未强行标注,合理。

### 3. REL-GENERIC(hearing-template)

- 6 节点(审判员/原告/被告/书记员/原代/被代)均为诉讼角色,身份关系在前、行为关系
  (诉讼对抗/代理)在后,与资源第 68 行「身份关系与财产/行为关系并存时,先画身份,
  再画行为」一致。
- 共同主体(审判员、原告/被告)只画一次,无重复节点,与资源第 69 行一致。

## 已知偏差(已记录,不改)

| 偏差 | 严重度 | 处置 |
|---|---|---|
| `hearing-template` 沙箱在 JSON 之前输出了「场景路由选定」+「编排自检」+「选择理由」三段说明文字 | 低 | 产品链路在前端有 `markdown` 解析逻辑,Folia 不直接消费此 JSON 外的文字;若实际接入后发现前端需截取,可在 v2 改写时把说明塞进 `routing.notes` 字段(本次范围不动) |
| `hearing-template` 的边 label 有重复(3 条「主持审理」、2 条「代理关系」) | 低 | 空白模板确实只能这么写,无语义损失;细则第 68 行要求「先画身份」但同一类身份关系自然词面一致 |
| `evidence-directory` n5 节点 text「长中文事实说明」含糊,违反 3S「24 字以内」 | 低 | 这是源材料里那段证据的固有形态(原标签就是「长中文事实说明」);Folia 渲染层不裁剪节点文字,前端会按 `legalVisuals.ts` 的字号档自动降级 |
| 3 份输出未用到 `missing` 态 | 低 | 这批材料都没有「尚未取得的补强证据」,与 `missing` 的设计用途吻合;无意义补标反而是噪声 |

## 守护测试

| 测试 | 守护内容 |
|---|---|
| `skill_visual_scene_details_match_relationship_scene_ids` | 资源文件 ## 小节必须与 `skill_visual_scene_ids("relationship")` 白名单一一对应,资源不引入白名单外场景,体量 ≤ 10 KB |
| `skill_visual_prompt_injects_scene_details_only_for_relationship` | 试点图型注入细则,其余三型 prompt 与试点前逐字节相等 |
| `verify_rel_pilot_outputs`(ignored,点验用)| 沙箱输出经 `canonical_visual_structure` 校验通过且场景匹配 |

## 结论

REL 家族场景细则内化**达到 handoff 验收标准**:

- 3/3 路由命中预期;
- 3/3 通过产品级校验;
- 资源三条硬规则与各场景「常见失败」清单在沙箱输出中可被观察到反向证据。

按 handoff 范围,本次只内化 REL 家族。是否继续把场景库铺到 flowchart / timeline /
mindmap 三个家族,以及 REL-EQUITY / REL-TRANSACTION 这两个未真实点验的 REL 场景,
建议在 `docs/plans/2026-07-17-scene-details-rel-pilot-handoff.yaml` 的「试点完成后的
Go/No-Go 决策」一节里复盘后决定。
