---
name: workfish-script
description: >-
  在 Workfish 工作区中创建或修改自定义节点脚本（NodeSpec + run）。
  触发：新建 workfish 节点、写 index.ts/main.py、改 meta/inputs/outputs、
  workfish 脚本节点、工作区 nodes 目录。
---
# Workfish 节点脚本

阶段 A **只**维护静态 `meta` 与 `run` 签名；服务端从源码抽取 meta，**不会**执行 `run`。

## 开始前（必做）

1. 读取应用配置 **`~/.workfish/config.json`**（固定路径，不要到自定义工作区根下去找 config）：
   - 用其中的 **`runtime`**（`node` 或 `python`）选择模板；
   - 用其中的 **`workspacePath`** 作为节点目录根（在其下写 `nodes/<id>/`）。
2. 按 runtime 选模板与入口文件名（见下），**不要**混用。

## 目录约定

在工作区根（默认 `~/.workfish`）下：

| 路径 | 用途 |
|------|------|
| `types/` | 自定义类型（`TypeDef`），供 `ref` 引用 |
| `nodes/<id>/` | 单个节点；**目录名必须与 `meta.id` 一致** |
| `workflows/` | 工作流 JSON（画布保存结果） |

### 入口文件

| runtime | 文件 | 导出 |
|---------|------|------|
| `node` | `nodes/<id>/index.ts` | `export const meta = { ... }`；`export async function run(inputs) { ... }` |
| `python` | `nodes/<id>/main.py` | 模块级 `meta = { ... }`；`async def run(inputs): ...` |

完整 echo 示例见本 skill 目录：`examples/echo-node.ts`、`examples/echo-node.py`（与 `@workfish/server` 初始化时写入的 `example-echo` 一致）。

## 编写 meta（NodeSpec）

**允许字段**（勿发明其它 meta 键）：`id`、`name`、可选 `description`、`version`、`inputs`、`outputs`、可选 `environments`。

### environments（环境槽位）

脚本若需要外部连接/密钥等配置，用 `environments` 声明**命名槽位**（非具体环境实例）。用户在画布检查器中把槽位绑定到「环境」面板里的具体环境（如测试库、生产库）。脚本节点还可在检查器「当前环境」中多选运行环境。

```ts
environments: [
  { key: 'source', name: '源库', description: '读取侧，例如测试库' },
  { key: 'target', name: '目标库', description: '写入侧，例如生产库' },
]
```

- `key`：稳定标识（camelCase），工作流里按此绑定
- `name`：界面显示名
- 可选 `description`
- **禁止**在 meta 或源码里写死库地址/密码；这些放在环境键值对中

### FieldSpec

`inputs` / `outputs` 的值为 `Record<string, FieldSpec>`。`type` 只能是：

`string` | `number` | `boolean` | `null` | `any` | `array` | `object` | `ref`

- **array**：可带 `items: FieldSpec`
- **object**：可带 `properties: Record<string, FieldSpec>`
- **ref**：必须带 `ref: "<TypeDef.id>"`，且工作区 `types/` 中存在对应类型定义
- 可选：`description`、`optional`

### 命名与文案

- 端口名（inputs/outputs 的 key）：**camelCase**
- `name` / `description`：简短清晰

### 禁止

- 在节点源码中写入 API Key、密码、token、JDBC URL 等密钥/连接串；放到工作区「环境」键值对，并通过 `environments` 槽位绑定。
- 伪造 `@workfish/spec` 不支持的 meta 字段。

## 生成或修改后的提醒

保存文件后，告知用户在 Web 画布点击 **「刷新」**（或重新打开编辑器），以便 `/api/nodes` 重新扫描并更新节点面板。

## 工作流建议

1. 确认 `runtime` → 复制对应 `examples/echo-node.*` 为起点。
2. 新建 `nodes/<your-id>/`，设置 `meta.id === '<your-id>'`。
3. 若使用 `ref`，先在 `types/` 添加类型文件。
4. 若需多环境（如测试/生产同步），声明 `environments` 槽位，并提醒用户在左侧「环境」中建分组与环境后，在检查器完成绑定。
5. 保存 → 提醒用户刷新画布 → 在面板拖拽节点验证 `ready` 状态。
