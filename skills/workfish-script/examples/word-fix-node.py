"""WordFix — 清理题库节点 JSON 中的音标字段

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
PATHS = ("$.uk_phonetic_symbol", "$.us_phonetic_symbol")


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
            f"JSON_CONTAINS_PATH(`{JSON_COL}`, 'one', %s)" for _ in PATHS
        )
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS c FROM `{TABLE}` WHERE {where_sql}",
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
                f"""UPDATE `{TABLE}`
                    SET `{JSON_COL}` = JSON_REMOVE(`{JSON_COL}`, {remove_args})
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
