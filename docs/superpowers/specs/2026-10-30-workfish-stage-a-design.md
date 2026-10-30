# Workfish 阶段 A 设计：规范脚本 → 解析 I/O → 可连线画布

**日期：** 2026-10-30  
**状态：** 已确认  

## 目标

人/AI 按统一规范编写节点脚本并导出 `meta`；本地服务静态解析输入/输出；React 画布自动生成可连线节点，支持类型校验与工作流 JSON 保存。本阶段**不执行**脚本。

## 产品形态

- 本地 Node 服务 + React 网页（`127.0.0.1`）
- 工作区默认 `~/.workfish`（可配置）
- 启动初始化：选择脚本环境 Node 或 Python → 探测本机可执行文件与版本 → 写入配置

## 架构（方案 1）

Monorepo：

| 包 | 职责 |
|----|------|
| `@workfish/spec` | NodeSpec/FieldSpec、校验、TS/Python meta 静态抽取、类型相容、工作流文档校验 |
| `@workfish/server` | 环境探测、工作区 IO、节点扫描、HTTP API |
| `@workfish/web` | 初始化向导、React Flow 编辑器 |
| `skills/workfish-script` | 约束 AI 按规范写节点 |

Web 不直读写盘，只调本机 API。`web` 可依赖 `spec` 做连线侧预校验。

## 工作区

```
~/.workfish/
  config.json
  types/*.type.json
  nodes/<id>/index.ts|index.js|main.py
  workflows/<id>.workflow.json
  .cache/          # 可选
```

`config.json` 字段：`version`、`workspacePath`、`runtime`（`node`|`python`）、`runtimePath`、`runtimeVersion`、`initializedAt`。  
一个工作区只绑定一种 runtime。

探测：Node `node -v`（建议 ≥ 18）；Python `python`/`python3`/`py -3`（建议 ≥ 3.10）。只探测，不自动安装、不建 venv。

## NodeSpec 与 FieldSpec

```ts
type NodeSpec = {
  id: string
  name: string
  description?: string
  version: string
  inputs: Record<string, FieldSpec>
  outputs: Record<string, FieldSpec>
}

type FieldSpec = {
  type: 'string' | 'number' | 'boolean' | 'null' | 'any' | 'array' | 'object' | 'ref'
  description?: string
  optional?: boolean
  items?: FieldSpec
  properties?: Record<string, FieldSpec>
  ref?: string
}
```

- Node：`export const meta` + `export async function run`（阶段 A 不调用）
- Python：模块级 `meta = {...}` + `def run`（阶段 A 不调用）
- 静态抽取，禁止执行用户代码
- `meta.id` 必须等于目录名；`ref` 必须在 `types/` 可解析

## API（最小集）

`GET /api/bootstrap`、`POST /api/init`、`POST /api/runtime/probe`、`GET|PUT /api/config`、`GET /api/nodes`、`POST /api/nodes/rescan`、`GET /api/types`、`GET|PUT /api/workflows`、`GET /api/workflows/:id`、`GET /api/health`。  
节点变更：watch + 防抖重扫；前端刷新或短轮询。SSE 可选后置。

## 画布与工作流

- 左：可用节点 + 问题列表；中：React Flow；右：检查器；顶栏：工作流/保存/刷新/设置
- 磁盘存领域模型 `WorkflowDocument`（非 RF 私有格式）
- 连线：仅 output→input；一 input 至多一边；类型不相容禁止连接
- catalog 中节点缺失/损坏时画布保留并标警告，不自动删除

## 工程

- pnpm workspaces；`pnpm dev` 并行 server（8787）+ web（5173，proxy `/api`）
- 根目录 README 为唯一使用说明；Skill 随仓库版本管理
- 明确不做：执行引擎、常量/密钥库、分支循环、多租户、自动装 runtime

## 完成定义（DoD）

1. 首次打开可完成初始化  
2. 按规范新增脚本后面板出现节点或明确错误  
3. 可拖拽、类型校验连线、保存/加载工作流  
4. 不调用 `run`
