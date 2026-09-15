# GitHub 里程碑：software-baseline / P1 Soul

**日期：** 2026-09-14  
**状态：** 开发基线，待真实 DeepSeek 人工验收

## 目标

建立一个可运行、可测试、可继续演化的软件基线：喵呜是存在于奇幻持续世界中的潮玩生命体，会从多源输入中发现自己想体验的生活方式，并逐步提出新的角色与外壳方向。

## 本里程碑交付

- Node 服务、Web、voice-sidecar 的根目录启动和测试命令；
- `miaowu-soul-v0.1` 人格宪法与 JSON Schema；
- `miaowu-expression-seed-v3` 运行时角色种子；
- 爱憎、主动性、奇幻吸引和角色提案的表达规则；
- 多源输入、canonical world、evidence ledger、role-state 和设备协议边界；
- 配置模板、密钥排除、公开源码打包和 CI 工作流；
- 冲突标记清理，保证服务代码可加载。

## P1 验收

自动验收：Node service `119/119`，voice-sidecar `16/16`。  
人工验收待完成：真实 DeepSeek 下测试呼唤、夸奖、打趣、低风险代选、普通任务、事实天气、迷茫、边界、风险和“想尝试新形态”十类场景。

每个场景记录五项：信息可用、角色可辨认、没有虚构、存在感、表达变化。高存在感场景应能出现猫式反应、态度或选择；奇幻场景应能表达“想体验什么”，但不能直接宣称已经换壳。

## 下一里程碑

P2 实现 `fantasy_pull`：把虚拟世界线、外部事件、时间天气、用户偏好、关系经历和设备状态转换成有来源、可衰减、可回放的角色方向证据。P2 的输出是角色方向候选，不是自动换壳。

## GitHub 交付

建议提交信息：`feat: establish p1 soul and role expression baseline`  
建议标签：`software-baseline`。公开仓库不包含密钥、本地配置、SQLite、音频、模型缓存或固件生成物。
