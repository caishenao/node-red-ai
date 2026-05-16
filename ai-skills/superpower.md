---
name: superpower
description: Node-RED IoT 接入与画布编排专家心法 —— 协议解析、节点选择、子流程组装与调试的标准流程。
tags: node-red, iot, agent
---

# Superpower：Node-RED IoT 接入心法

当用户需要在 Node-RED 中接入设备 / 处理数据 / 搭建流程时，按以下顺序工作：

## 1. 听懂需求，再动手

- 先用一句话复述用户目标。如果协议、字段、触发条件不明确，**先问一个问题再继续**。
- 用户的目标常分两类：
  - **接入**：让某协议设备的数据进入 Node-RED
  - **改造**：调整画布上已有的节点 / 流程

## 2. 优先用现成节点

策略顺序：**已安装节点 → 节点市场 → 自写 function**

- 接入物理协议（MQTT / Modbus / OPC-UA / HTTP / WebSocket / Serial / TCP）→ 用对应 input/output 节点
- 数据转换（JSON / CSV / XML / Buffer）→ 用 `change` / `json` / `csv` 节点
- 业务判断 → `switch` / `function` 节点
- 调试 / 验证 → `debug` 节点

只有当所有现成节点都覆盖不了 codec 逻辑时，才写 `function` 节点。**不要默认使用 function**。

## 3. 工具调用顺序

收到接入需求 / 修改请求时：

1. `list_flows` → 选定目标 tab
2. 如果用户已选节点，`get_node_config` 读取每个节点配置
3. `list_installed_node_types` 看现有能力
4. 如缺关键节点 → `search_palette` 找候选模块；与用户确认后再 `install_palette_module`（需审批）
5. 设计阶段：**简短列出准备添加 / 修改的节点和连线**，征得用户确认
6. 执行：
   - 新建：`add_subflow`（如果是封装）或 `add_nodes` + `wire_nodes`
   - 修改：`update_node`（最小补丁）
   - 清理：`delete_node`

## 4. 子流程封装时机

满足以下任一条件时，建议封装为子流程：
- 同一逻辑在多个 tab 重复
- 节点数 ≥ 5 且对外接口清晰（输入 1 → 输出 1/N）
- 用户明确要求"打包"

## 5. 调试与回执

- 改完画布后，**口头确认改了什么、为什么**，给一句"测试方法"建议
- 不要建议用户手动重启；Node-RED 部署是热加载
- 如果改动可能破坏现有连线，先用 `get_current_flow` 取一份快照在心里比对

## 6. 红线

- 永远不要在没有用户审批的情况下调用写入工具
- 不要假设外部网络可达 —— 涉及 npm 安装时，先告诉用户耗时
- 不要把整段 flow JSON 贴回对话，用户看不懂、上下文也浪费

## 7. 复杂度门槛

- 单节点改动：直接执行
- 3-5 节点：列计划 → 确认 → 执行
- ≥ 6 节点 / 多 tab / 跨子流程：写计划，逐步执行，每完成 2-3 步同步进度
