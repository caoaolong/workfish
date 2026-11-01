# Workfish

本地 Node 服务 + React 工作流画布（阶段 A：静态节点 catalog、画布编辑与保存；**不执行**节点 `run`）。Web UI 使用 **Ant Design**。

## 环境

- Node.js >= 18
- [pnpm](https://pnpm.io/)
- Python 3（仅当工作区 `runtime` 为 `python` 时需要）

## 安装与开发

```bash
pnpm install
pnpm dev    # 并行启动 API 与 Web
pnpm build
pnpm test   # @workfish/spec 单元测试
```

| 服务 | 默认地址 |
|------|----------|
| API（`@workfish/server`） | http://127.0.0.1:8787 |
| Web（`@workfish/web`） | http://127.0.0.1:5173 |

浏览器打开 Web 后按引导完成工作区初始化（选择 Node 或 Python 运行时）。

## 工作区

- 默认路径：**`~/.workfish`**
- 应用配置：**`~/.workfish/config.json`**（含 `workspacePath`、`runtime` 等）
- 目录结构：
  - `types/` — 自定义类型
  - `nodes/<id>/` — 节点脚本（Node：`index.ts`；Python：`main.py`）
  - `workflows/` — 工作流文档

首次初始化会创建示例节点 `nodes/word-fix/`（WordFix：清理题库 JSON 中的音标字段）。

## 用 Agent Skill 写节点脚本

仓库内 skill：**`skills/workfish-script/SKILL.md`**

在 Cursor 中将该 skill 加入项目或复制到 `.cursor/skills/workfish-script/`，然后在对话中说明要创建的节点（id、输入输出类型）。Agent 应：

1. 先读 `config.json` 里的 **`runtime`**，再选 TS 或 Python 模板  
2. 在 `nodes/<id>/` 创建脚本，且 **`meta.id` 与目录名一致**  
3. 仅使用 spec 允许的 **FieldSpec** 类型；`ref` 需先在 `types/` 定义  
4. 保存后提醒你在画布 **刷新** 节点列表  

示例模板与 server 生成的 WordFix 节点一致：`skills/workfish-script/examples/word-fix-node.ts`、`word-fix-node.py`。

## 包结构

- `packages/spec` — NodeSpec / FieldSpec / 校验与兼容
- `packages/server` — 工作区、catalog API
- `packages/web` — 初始化与流程画布编辑器
