import { createConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
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
const PATHS = ['$.uk_phonetic_symbol', '$.us_phonetic_symbol'] as const;

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
    throw new Error(`缺少 ${name}：请在检查器填写，或选择含同名键的环境`);
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
    throw new Error(`DB_PORT 无效：${portRaw}`);
  }
  const dryRun = pickBool(inputs, 'DRY_RUN');

  await wf_printf(`正在连接 MySQL ${user}@${host}:${port}/${database} …`);

  const conn = await createConnection({
    host,
    port,
    user,
    password,
    database,
    connectTimeout: 10_000,
  });

  try {
    const whereSql = PATHS.map((p) => `JSON_CONTAINS_PATH(\`${JSON_COL}\`, 'one', '${p}')`).join(
      ' OR ',
    );
    const [countRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`${TABLE}\` WHERE ${whereSql}`,
    );
    const matched = Number(countRows[0]?.c ?? 0);
    await wf_printf(
      `表 ${TABLE} 中含 uk_phonetic_symbol / us_phonetic_symbol 的行：${matched}`,
    );

    if (dryRun) {
      const message = `DRY_RUN：将影响 ${matched} 行，未写库`;
      await wf_printf(message);
      return { ok: true, message, matched, updated: 0, dryRun: true };
    }

    if (matched === 0) {
      const message = '无需更新：未找到含目标字段的行';
      await wf_printf(message);
      return { ok: true, message, matched: 0, updated: 0, dryRun: false };
    }

    const removeArgs = PATHS.map((p) => `'${p}'`).join(', ');
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE \`${TABLE}\`
       SET \`${JSON_COL}\` = JSON_REMOVE(\`${JSON_COL}\`, ${removeArgs})
       WHERE ${whereSql}`,
    );
    const updated = Number(result.affectedRows ?? 0);
    const message = `已从 ${updated} 行的 ${JSON_COL} 中删除 uk_phonetic_symbol / us_phonetic_symbol`;
    await wf_printf(message);
    return { ok: true, message, matched, updated, dryRun: false };
  } finally {
    await conn.end();
  }
}
