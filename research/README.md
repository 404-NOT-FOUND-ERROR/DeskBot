# 桌宠角色—形态研究底座

本目录用于同济大学工业设计（机械）毕业设计的研究与工程记录。

## 当前研究问题

如何将对话、设备感知和事件记录等多源证据，转化为可解释的角色状态变化，并进一步映射为桌宠的行为反馈与可打印、可装配、可替换外壳。

## 技术底座与研究边界

- DeskBot Service：唯一的输入收口、角色状态真相和 LLM/输出编排核心，记录证据、权重、状态变化和触发理由。
- RisuAI：仅参考或对照“文本 -> 情绪标签 -> 立绘”映射，不作为运行依赖。
- SillyTavern：仅参考或对照“条件触发 -> prompt 选择性注入”机制，不作为运行依赖。
- ESP-CLAW：ESP32 薄设备运行时，负责感知、显示、语音播放和运动执行，不保存角色真相。
- ESP-VoCat v1.2 成品适配目标；ESP-Ditto 标准版作为模块化硬件与扩展接口参考。
- 自研内骨架与外壳接口：保护硬件并保证外壳可打印、可装配、可替换。

开源项目只承担基础设施，不替代以下研究贡献：多源证据建模、角色演化规则、语义到行为/形态的映射、可打印几何约束和用户评价。

## 最小闭环

```text
一条对话或设备事件
  -> DeskBot Service 统一事件
  -> 情绪/世界条件/CAPS-inspired 融合
  -> evidence ledger + role-state.v1
  -> LLM 回复 + interaction-contract.v0.1 输出计划
  -> ESP-CLAW/VoCat 表情、语音、朝向/NFC 事件
  -> 形态变化候选
```

## 目录

- `development-roadmap-v0.1.md`：从开源选型、软件闭环、VoCat 实机、中性内核、三组外壳到用户实验和论文的整体路线图。
- `role-state-v1.md`：角色状态协议、字段说明和示例。
- `protocol/interaction-contract-v0.1.md`：DeskBot Service、设备桥接层和实体桌宠之间的软件—硬件交互契约。
- `protocol/input-state-output-v0.1.md`：DeskBot 对话、统一输入层、情绪/CAPS 状态和网页/硬件输出的职责边界。
- `shell-interface-v1.md`：固定内骨架与可替换外壳的接口规范草案。
- `mvp-2-week-checklist.md`：两周最小可行原型及记录要求。
- `research-design-v0.1.md`：研究问题、实验变量、评价指标与阶段性实验。
- `hardware/esp-ditto-reproduction-guide-v0.1.md`：从开源工程到 PCBA、装配和上电的复刻流程。
- `hardware/pcba-preorder-gate.md`：首批 PCBA 付款前的硬性检查清单。
- `hardware/mcu-decision.md`：N8R8、N16R8 与页面 N8R4 录入值的选择结论。
- `hardware/vocat-firmware-audit-v0.1.md`：已组装喵伴 v1.2 的 Coze/OpenAI Launchpad 镜像、源码可复现性、API 兼容性和刷写记录。
- `hardware/vocat-baseline-g0.md`：任何固件改造前的喵伴 v1.2 硬件、原厂语音链路和稳定性基线记录表。
- `logs/`：实验日志、测量数据、故障记录。
- `cad/`：硬件包络、内骨架、接口件和外壳版本。

## 版本规则

所有协议和机械接口都带版本号。接口一旦用于打印或联调，只做向后兼容修改；破坏性修改升级主版本，并保留旧版样件和记录。
