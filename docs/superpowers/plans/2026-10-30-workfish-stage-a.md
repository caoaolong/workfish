# Workfish 阶段 A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地规范脚本解析 + 本地服务 + React 可连线画布（不执行脚本）。

**Architecture:** pnpm monorepo：`@workfish/spec`（契约与静态抽取）、`@workfish/server`（工作区/探测/API）、`@workfish/web`（向导 + React Flow）；用户数据在 `~/.workfish`；AI 通过 `skills/workfish-script` 按规范写节点。

**Tech Stack:** TypeScript、pnpm workspaces、Node http（或 Hono/Express）、Vite、React、@xyflow/react、vitest。

**Spec:** `docs/superpowers/specs/2026-10-30-workfish-stage-a-design.md`

## Global Constraints

- 仅绑定 `127.0.0.1`；默认端口 server `8787`、web `5173`
- 禁止执行用户节点代码；meta 仅静态抽取
- 一个工作区单一 `runtime`：`node` | `python`
- 默认工作区：用户主目录下 `.workfish`
- Node 建议 ≥ 18，Python 建议 ≥ 3.10
- 文档只维护根 `README.md` + 本计划/设计；不另写一堆 md
- **不要自动 git commit**（除非用户明确要求）；计划中的 Commit 步骤一律跳过
- 回复与提交说明使用中文

## File Map

| 路径 | 职责 |
|------|------|
| `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json` | monorepo 根 |
| `packages/spec/src/schema.ts` | 类型与常量 |
| `packages/spec/src/validate.ts` | NodeSpec / Workflow / TypeDef 校验 |
| `packages/spec/src/extract-ts.ts` | TS/JS `export const meta` 抽取 |
| `packages/spec/src/extract-py.ts` | Python `meta = {...}` 抽取 |
| `packages/spec/src/compatibility.ts` | FieldSpec 相容 |
| `packages/spec/src/catalog.ts` | 扫描目录产出 CatalogItem |
| `packages/server/src/*` | bootstrap、probe、workspace、routes、watch |
| `packages/web/src/*` | InitWizard、Editor、api client |
| `skills/workfish-script/SKILL.md` | AI 规范 |
| `README.md` | 安装与启动 |

---

### Task 1: Monorepo 脚手架

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`
- Create: `packages/spec/package.json`, `packages/spec/tsconfig.json`, `packages/spec/src/index.ts`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/index.ts`
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx`

**Interfaces:**
- Produces: workspaces `@workfish/spec`、`@workfish/server`、`@workfish/web`；根脚本 `dev` / `build` / `test`

- [ ] **Step 1: 写入根配置**

`package.json`：
```json
{
  "name": "workfish",
  "private": true,
  "scripts": {
    "dev": "pnpm -r --parallel --filter @workfish/server --filter @workfish/web dev",
    "build": "pnpm -r build",
    "test": "pnpm --filter @workfish/spec test"
  },
  "engines": { "node": ">=18" }
}
```

`pnpm-workspace.yaml`：
```yaml
packages:
  - 'packages/*'
```

`.gitignore` 包含：`node_modules`、`dist`、`.cache`、覆盖率产物。

`tsconfig.base.json`：`strict: true`，`moduleResolution: bundler`，`target: ES2022`。

- [ ] **Step 2: 创建三包最小 package.json**

- `@workfish/spec`：`"type": "module"`，依赖 `vitest`，scripts：`test`、`build`（tsc）
- `@workfish/server`：依赖 `@workfish/spec`（workspace:*）、scripts：`dev`（tsx watch）、`build`
- `@workfish/web`：依赖 `react`、`react-dom`、`@xyflow/react`、`@workfish/spec`；devDependencies：`vite`、`@vitejs/plugin-react`；`dev`/`build`

- [ ] **Step 3: Vite proxy**

`packages/web/vite.config.ts` 将 `/api` 代理到 `http://127.0.0.1:8787`。

- [ ] **Step 4: 安装并验证**

Run: `pnpm install`  
Expected: 成功，无缺包报错。

- [ ] **Step 5: Commit** — 跳过（除非用户要求）

---

### Task 2: `@workfish/spec` schema + validate（TDD）

**Files:**
- Create: `packages/spec/src/schema.ts`, `validate.ts`, `index.ts`
- Test: `packages/spec/src/validate.test.ts`

**Interfaces:**
- Produces:
  - `FieldSpec`, `NodeSpec`, `TypeDef`, `WorkflowDocument`, `NodeCatalogItem`
  - `validateNodeSpec(input: unknown): { ok: true; value: NodeSpec } | { ok: false; errors: Diagnostic[] }`
  - `validateTypeDef`, `validateWorkflowDocument`
  - `Diagnostic = { path: string; message: string }`

- [ ] **Step 1: 写失败测试**

覆盖：合法 NodeSpec 通过；缺少 `id` 失败；非法 `type` 失败；`type:'ref'` 缺 `ref` 失败；合法最小 WorkflowDocument 通过。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @workfish/spec test`  
Expected: FAIL（模块不存在或函数未实现）

- [ ] **Step 3: 实现 schema + validate**

手写校验即可（不必上 ajv）。`FieldSpec.type` 枚举与设计文档一致。递归校验 `items` / `properties`。

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @workfish/spec test`  
Expected: PASS

- [ ] **Step 5: Commit** — 跳过

---

### Task 3: TS / Python meta 抽取（TDD）

**Files:**
- Create: `packages/spec/src/extract-ts.ts`, `extract-py.ts`
- Test: `packages/spec/src/extract-ts.test.ts`, `extract-py.test.ts`
- Create fixtures under `packages/spec/fixtures/`

**Interfaces:**
- Produces:
  - `extractMetaFromTs(source: string): { ok: true; meta: unknown } | { ok: false; errors: Diagnostic[] }`
  - `extractMetaFromPy(source: string):` 同上
- 仅接受对象字面量赋值；含函数调用/标识符引用则失败并给出明确 message

- [ ] **Step 1: 写 fixtures + 失败测试**

TS 成功样例：`export const meta = { id: 'echo', name: 'Echo', version: '0.1.0', inputs: {...}, outputs: {...} }`  
TS 失败：`export const meta = buildMeta()`  
Python 成功：`meta = { "id": "echo", ... }`  
Python 失败：`meta = load()`

- [ ] **Step 2: 实现抽取**

TS：用 `typescript` 编译器 API 解析，找到 `ExportKeyword` 的 `meta` VariableDeclaration，对象字面量转为 JSON 兼容结构（允许 as const / 满足字面量）。  
Python：用简易 AST（可依赖 `filbert` 或手写对 dict 字面量的受限解析）；若引入重依赖成本高，阶段 A 可用「正则 + JSON 兼容字面量」严格子集，并在错误信息中说明必须用 JSON 风格字面量（双引号键等）——**优先**：用 TypeScript 实现一个只解析 Python dict/list/str/number/bool/None 字面量的小解析器，避免执行。

- [ ] **Step 3: 测试通过**

Run: `pnpm --filter @workfish/spec test`  
Expected: PASS

- [ ] **Step 4: Commit** — 跳过

---

### Task 4: 类型相容 + catalog 扫描

**Files:**
- Create: `packages/spec/src/compatibility.ts`, `catalog.ts`
- Test: `packages/spec/src/compatibility.test.ts`, `catalog.test.ts`

**Interfaces:**
- Produces:
  - `isCompatible(source: FieldSpec, target: FieldSpec, types: Map<string, TypeDef>): boolean`
  - `scanNodesDir(opts: { nodesDir: string; typesDir: string; runtime: 'node'|'python'; readFile: (p:string)=>string; listDirs: (p:string)=>string[] }): NodeCatalogItem[]`
- 规则：同 primitive OK；`any` OK；同 `ref` OK；`object` 浅层 properties 一一相容则 OK；否则 false
- catalog：按 runtime 找入口文件；抽取 → validateNodeSpec → 校验 id===目录名 → 解析所有 ref；失败项 `status:'error'`

- [ ] **Step 1: 测试相容与扫描（用临时目录 fixture）**
- [ ] **Step 2: 实现并跑通测试**
- [ ] **Step 3: Commit** — 跳过

---

### Task 5: Server — workspace、probe、bootstrap/init

**Files:**
- Create: `packages/server/src/paths.ts`, `runtime-probe.ts`, `workspace.ts`, `config.ts`, `bootstrap.ts`, `http.ts`, `routes/init.ts`, `index.ts`

**Interfaces:**
- Produces HTTP on `127.0.0.1:8787`：
  - `GET /api/health` → `{ ok: true }`
  - `GET /api/bootstrap` → `{ initialized, config?, runtimeHealth? }`
  - `POST /api/init` body `{ workspacePath?, runtime: 'node'|'python', runtimePath? }`
  - `POST /api/runtime/probe` body `{ runtime, runtimePath? }`
  - `GET /api/config` / `PUT /api/config`
- `probeNode` / `probePython`：spawn 同步/异步执行 `-v`/`--version`，解析版本
- `ensureWorkspaceSkeleton`：创建 types/nodes/workflows，写入示例 `nodes/example-echo`

- [ ] **Step 1: 实现 probe（可对真实本机 node 测）与 config 读写**
- [ ] **Step 2: 实现最小 HTTP 路由（可用 Node 原生 `http` + 手写 router，或 hono）**
- [ ] **Step 3: 手动 curl 验证 health/bootstrap/init**
- [ ] **Step 4: Commit** — 跳过

示例节点内容与 Skill 示例保持一致（Node 用 `index.ts` 字面量 meta；若 init 时 runtime=python 则写 `main.py`）。

---

### Task 6: Server — nodes/types/workflows API + watch

**Files:**
- Create: `packages/server/src/catalog-service.ts`, `routes/nodes.ts`, `routes/types.ts`, `routes/workflows.ts`, `watch.ts`

**Interfaces:**
- `GET /api/nodes`、`POST /api/nodes/rescan`
- `GET /api/types`
- `GET /api/workflows`、`GET /api/workflows/:id`、`PUT /api/workflows/:id`（校验后写入）
- watch `nodes/`、`types/` 防抖 300ms 重扫内存缓存

- [ ] **Step 1: 实现 API 并联调**
- [ ] **Step 2: 用临时 workspace 放一个坏节点，确认 `/api/nodes` 返回 error 项**
- [ ] **Step 3: Commit** — 跳过

---

### Task 7: Web — 初始化向导

**Files:**
- Create: `packages/web/src/api/client.ts`, `pages/InitWizard.tsx`, `App.tsx`

**Interfaces:**
- 启动调 `GET /api/bootstrap`；未初始化渲染向导：工作区路径 → 选 runtime → probe 展示版本 → 提交 `POST /api/init`
- 已初始化进入 Editor 占位页

- [ ] **Step 1: 实现 api client 与向导 UI（简洁表单，中文文案）**
- [ ] **Step 2: `pnpm dev` 手动走通首次初始化**
- [ ] **Step 3: Commit** — 跳过

---

### Task 8: Web — 画布编辑器

**Files:**
- Create: `packages/web/src/editor/EditorPage.tsx`, `NodePalette.tsx`, `WorkflowCanvas.tsx`, `Inspector.tsx`, `workflowMapper.ts`

**Interfaces:**
- 消费 `GET /api/nodes`、`GET/PUT /api/workflows/:id`
- 自定义节点：左右 handles，id 为字段名
- 连线时用 `isCompatible`；拒绝则提示
- `workflowMapper`：`WorkflowDocument` ↔ React Flow nodes/edges
- 顶栏：新建/保存/刷新；左侧问题列表

- [ ] **Step 1: 实现三栏布局 + 拖拽 + 连线校验 + 保存加载**
- [ ] **Step 2: 手动验收 DoD 清单（见下）**
- [ ] **Step 3: Commit** — 跳过

---

### Task 9: Skill + README + 示例对齐

**Files:**
- Create: `skills/workfish-script/SKILL.md`, `skills/workfish-script/examples/echo-node.ts`, `examples/echo-node.py`
- Modify: `README.md`

**Interfaces:**
- Skill 写明：读 config.runtime、目录约定、FieldSpec、禁止密钥进源码、生成后刷新画布
- README：pnpm install / pnpm dev、默认端口、工作区路径、如何用 Skill

- [ ] **Step 1: 写 Skill 与 README**
- [ ] **Step 2: 确认示例与 server 生成的 example-echo 一致**
- [ ] **Step 3: Commit** — 跳过

---

## 手动验收（DoD）

1. 清空或换临时目录作 workspace，首次打开完成 Node 初始化并看到版本  
2. 示例节点出现在面板；画布可拖入  
3. 故意改坏 meta → 问题列表有错误，节点不可用  
4. 两节点相容端口可连，不相容不可连  
5. 保存后重启 server，工作流仍在  
6. 全程无调用 `run`

---

## Spec 覆盖自检

| 需求 | Task |
|------|------|
| 工作区与 init/探测 | 5 |
| NodeSpec/FieldSpec/ref | 2–4 |
| TS/Python 静态抽取 | 3 |
| API 与 catalog | 5–6 |
| 画布连线与工作流 | 8 |
| Skill | 9 |
| 不执行 run | 全局约束 |

## Placeholder 扫描

无 TBD；Commit 步骤统一跳过。
