"""Run one SQL statement against the e2e database and print the rows as JSON: python sqlq.py <db_url> <sql> [json params]"""
import asyncio
import json
import sys

import asyncpg


async def main() -> None:
    url, sql = sys.argv[1], sys.argv[2]
    params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
    conn = await asyncpg.connect(url)
    try:
        if sql.strip().lower().startswith(("select", "with")):
            rows = await conn.fetch(sql, *params)
            print(json.dumps([dict(r) for r in rows], default=str))
        else:
            await conn.execute(sql, *params)
            print("[]")
    finally:
        await conn.close()


asyncio.run(main())
