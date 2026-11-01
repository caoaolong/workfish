import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { extractMetaFromTs, extractMetaFromPy } from '@workfish/spec';
import type { WorkfishRuntime } from './config.js';
import { ensureEnvironmentsDir } from './environments-service.js';
import { ensureWfLib } from './wf-lib.js';

const WORD_FIX_NODE_TS = `import { createConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { wf_printf } from 'wf';

/**
 * WordFix — 清理题库节点 JSON 中的音标字段
 *
 * 从 tiku_content_node.node_json 删除：
 * - uk_phonetic_symbol
 * - us_phonetic_symbol
 */
export const meta = {
  id: 'word-fix',
  name: 'WordFix',
  description:
    '清理 tiku_content_node.node_json 中的 uk_phonetic_symbol / us_phonetic_symbol 字段。',
  version: '0.2.0',
  inputs: {
    DB_HOST: { type: 'string', description: '数据库主机' },
    DB_PORT: { type: 'string', optional: true, description: '端口，默认 3306' },
    DB_USER: { type: 'string', description: '用户名' },
    DB_PASSWORD: { type: 'string', description: '密码' },
    DB_DATABASE: { type: 'string', description: '库名' },
    DRY_RUN: {
      type: 'boolean',
      optional: true,
      description: '为 true 时只统计将受影响的行数，不写库',
    },
  },
  outputs: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    matched: { type: 'number', optional: true },
    updated: { type: 'number', optional: true },
    dryRun: { type: 'boolean', optional: true },
  },
};

const TABLE = 'tiku_content_node';
const JSON_COL = 'node_json';
const PATHS = ['\$.uk_phonetic_symbol', '\$.us_phonetic_symbol'] as const;

function pick(
  inputs: Record<string, unknown>,
  name: string,
  required: boolean,
): string {
  const fromInput = inputs[name];
  if (typeof fromInput === 'string' && fromInput.trim()) {
    return fromInput.trim();
  }
  if (typeof fromInput === 'number' && Number.isFinite(fromInput)) {
    return String(fromInput);
  }
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && String(fromEnv).trim()) {
    return String(fromEnv).trim();
  }
  if (required) {
    throw new Error(\`缺少 \${name}：请在检查器填写，或选择含同名键的环境\`);
  }
  return '';
}

function pickBool(inputs: Record<string, unknown>, name: string): boolean {
  const fromInput = inputs[name];
  if (typeof fromInput === 'boolean') {
    return fromInput;
  }
  if (typeof fromInput === 'string') {
    const lower = fromInput.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') {
      return false;
    }
  }
  const fromEnv = process.env[name];
  if (fromEnv !== undefined) {
    const lower = String(fromEnv).trim().toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }
  return false;
}

export async function run(inputs: Record<string, unknown> = {}) {
  const host = pick(inputs, 'DB_HOST', true);
  const user = pick(inputs, 'DB_USER', true);
  const password = pick(inputs, 'DB_PASSWORD', true);
  const database = pick(inputs, 'DB_DATABASE', true);
  const portRaw = pick(inputs, 'DB_PORT', false) || '3306';
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(\`DB_PORT 无效：\${portRaw}\`);
  }
  const dryRun = pickBool(inputs, 'DRY_RUN');

  await wf_printf(\`正在连接 MySQL \${user}@\${host}:\${port}/\${database} …\`);

  const conn = await createConnection({
    host,
    port,
    user,
    password,
    database,
    connectTimeout: 10_000,
  });

  try {
    const whereSql = PATHS.map((p) => \`JSON_CONTAINS_PATH(\\\`\${JSON_COL}\\\`, 'one', '\${p}')\`).join(
      ' OR ',
    );
    const [countRows] = await conn.query<RowDataPacket[]>(
      \`SELECT COUNT(*) AS c FROM \\\`\${TABLE}\\\` WHERE \${whereSql}\`,
    );
    const matched = Number(countRows[0]?.c ?? 0);
    await wf_printf(
      \`表 \${TABLE} 中含 uk_phonetic_symbol / us_phonetic_symbol 的行：\${matched}\`,
    );

    if (dryRun) {
      const message = \`DRY_RUN：将影响 \${matched} 行，未写库\`;
      await wf_printf(message);
      return { ok: true, message, matched, updated: 0, dryRun: true };
    }

    if (matched === 0) {
      const message = '无需更新：未找到含目标字段的行';
      await wf_printf(message);
      return { ok: true, message, matched: 0, updated: 0, dryRun: false };
    }

    const removeArgs = PATHS.map((p) => \`'\${p}'\`).join(', ');
    const [result] = await conn.query<ResultSetHeader>(
      \`UPDATE \\\`\${TABLE}\\\`
       SET \\\`\${JSON_COL}\\\` = JSON_REMOVE(\\\`\${JSON_COL}\\\`, \${removeArgs})
       WHERE \${whereSql}\`,
    );
    const updated = Number(result.affectedRows ?? 0);
    const message = \`已从 \${updated} 行的 \${JSON_COL} 中删除 uk_phonetic_symbol / us_phonetic_symbol\`;
    await wf_printf(message);
    return { ok: true, message, matched, updated, dryRun: false };
  } finally {
    await conn.end();
  }
}
`;

const WORD_FIX_NODE_PY = `"""WordFix — 清理题库节点 JSON 中的音标字段

从 tiku_content_node.node_json 删除：
- uk_phonetic_symbol
- us_phonetic_symbol

依赖：pip install pymysql
"""

import os

meta = {
  "id": "word-fix",
  "name": "WordFix",
  "description": "清理 tiku_content_node.node_json 中的 uk_phonetic_symbol / us_phonetic_symbol 字段。",
  "version": "0.2.0",
  "inputs": {
    "DB_HOST": { "type": "string", "description": "数据库主机" },
    "DB_PORT": { "type": "string", "optional": True, "description": "端口，默认 3306" },
    "DB_USER": { "type": "string", "description": "用户名" },
    "DB_PASSWORD": { "type": "string", "description": "密码" },
    "DB_DATABASE": { "type": "string", "description": "库名" },
    "DRY_RUN": {
      "type": "boolean",
      "optional": True,
      "description": "为 true 时只统计将受影响的行数，不写库",
    },
  },
  "outputs": {
    "ok": { "type": "boolean" },
    "message": { "type": "string" },
    "matched": { "type": "number", "optional": True },
    "updated": { "type": "number", "optional": True },
    "dryRun": { "type": "boolean", "optional": True },
  },
}

TABLE = "tiku_content_node"
JSON_COL = "node_json"
PATHS = ("\$.uk_phonetic_symbol", "\$.us_phonetic_symbol")


def _pick(inputs, name: str, required: bool) -> str:
    from_input = inputs.get(name) if isinstance(inputs, dict) else None
    if isinstance(from_input, str) and from_input.strip():
        return from_input.strip()
    if isinstance(from_input, (int, float)) and not isinstance(from_input, bool):
        return str(from_input)
    from_env = os.environ.get(name)
    if from_env is not None and str(from_env).strip():
        return str(from_env).strip()
    if required:
        raise RuntimeError(f"缺少 {name}：请在检查器填写，或选择含同名键的环境")
    return ""


def _pick_bool(inputs, name: str) -> bool:
    from_input = inputs.get(name) if isinstance(inputs, dict) else None
    if isinstance(from_input, bool):
        return from_input
    if isinstance(from_input, str):
        lower = from_input.strip().lower()
        if lower in ("true", "1", "yes"):
            return True
        if lower in ("false", "0", "no", ""):
            return False
    from_env = os.environ.get(name)
    if from_env is not None:
        lower = str(from_env).strip().lower()
        return lower in ("true", "1", "yes")
    return False


async def run(inputs=None):
    from wf import wf_printf

    if inputs is None:
        inputs = {}

    try:
        import pymysql
    except ImportError as e:
        raise RuntimeError("未安装 pymysql，请执行: pip install pymysql") from e

    host = _pick(inputs, "DB_HOST", True)
    user = _pick(inputs, "DB_USER", True)
    password = _pick(inputs, "DB_PASSWORD", True)
    database = _pick(inputs, "DB_DATABASE", True)
    port_raw = _pick(inputs, "DB_PORT", False) or "3306"
    try:
        port = int(port_raw)
    except ValueError as e:
        raise RuntimeError(f"DB_PORT 无效：{port_raw}") from e
    if port <= 0:
        raise RuntimeError(f"DB_PORT 无效：{port_raw}")
    dry_run = _pick_bool(inputs, "DRY_RUN")

    wf_printf(f"正在连接 MySQL {user}@{host}:{port}/{database} …")

    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        connect_timeout=10,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        where_sql = " OR ".join(
            f"JSON_CONTAINS_PATH(\`{JSON_COL}\`, 'one', %s)" for _ in PATHS
        )
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS c FROM \`{TABLE}\` WHERE {where_sql}",
                PATHS,
            )
            row = cur.fetchone() or {}
            matched = int(row.get("c") or 0)
        wf_printf(
            f"表 {TABLE} 中含 uk_phonetic_symbol / us_phonetic_symbol 的行：{matched}"
        )

        if dry_run:
            message = f"DRY_RUN：将影响 {matched} 行，未写库"
            wf_printf(message)
            return {
                "ok": True,
                "message": message,
                "matched": matched,
                "updated": 0,
                "dryRun": True,
            }

        if matched == 0:
            message = "无需更新：未找到含目标字段的行"
            wf_printf(message)
            return {
                "ok": True,
                "message": message,
                "matched": 0,
                "updated": 0,
                "dryRun": False,
            }

        remove_args = ", ".join(["%s"] * len(PATHS))
        with conn.cursor() as cur:
            cur.execute(
                f"""UPDATE \`{TABLE}\`
                    SET \`{JSON_COL}\` = JSON_REMOVE(\`{JSON_COL}\`, {remove_args})
                    WHERE {where_sql}""",
                (*PATHS, *PATHS),
            )
            updated = int(cur.rowcount or 0)
        conn.commit()
        message = (
            f"已从 {updated} 行的 {JSON_COL} 中删除 "
            "uk_phonetic_symbol / us_phonetic_symbol"
        )
        wf_printf(message)
        return {
            "ok": True,
            "message": message,
            "matched": matched,
            "updated": updated,
            "dryRun": False,
        }
    finally:
        conn.close()
`;

function writeIfMissing(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }
  writeFileSync(filePath, content, 'utf8');
}

/** 移除已废弃的示例节点目录（若存在） */
function removeLegacyNodes(workspacePath: string): void {
  for (const name of ['example-echo', 'ipa-fix']) {
    const legacy = path.join(workspacePath, 'nodes', name);
    if (existsSync(legacy)) {
      rmSync(legacy, { recursive: true, force: true });
    }
  }
}

export function ensureWorkspaceSkeleton(workspacePath: string, runtime: WorkfishRuntime): void {
  mkdirSync(path.join(workspacePath, 'nodes'), { recursive: true });
  mkdirSync(path.join(workspacePath, 'workflows'), { recursive: true });
  ensureEnvironmentsDir(workspacePath);
  ensureWfLib(workspacePath);
  removeLegacyNodes(workspacePath);

  const nodeDir = path.join(workspacePath, 'nodes', 'word-fix');
  mkdirSync(nodeDir, { recursive: true });

  if (runtime === 'node') {
    const indexPath = path.join(nodeDir, 'index.ts');
    writeIfMissing(indexPath, WORD_FIX_NODE_TS);
    const extracted = extractMetaFromTs(WORD_FIX_NODE_TS);
    if (!extracted.ok) {
      throw new Error('WordFix 节点 meta 无法被 @workfish/spec 解析');
    }
  } else {
    const mainPath = path.join(nodeDir, 'main.py');
    writeIfMissing(mainPath, WORD_FIX_NODE_PY);
    const extracted = extractMetaFromPy(WORD_FIX_NODE_PY);
    if (!extracted.ok) {
      throw new Error('WordFix 节点 meta 无法被 @workfish/spec 解析');
    }
  }
}

export function isWorkspaceInitialized(workspacePath: string): boolean {
  return existsSync(path.join(workspacePath, 'config.json'));
}
