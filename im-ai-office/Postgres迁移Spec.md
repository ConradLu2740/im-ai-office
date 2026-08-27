# IMAI · Postgres 迁移 Spec（Step 3）

> 时间：2026-08-27 ｜ 关联：《架构分析报告.md》Step 3 ｜ 前置：step2-done
> 目标：后端支持 **SQLite / Postgres 双后端**，生产切 Postgres（数据不出域不变），SQLite 保留为开发/测试快速模式。

---

## 1. 运行时现状（2026-08-27 实测）

- **Postgres 容器已就绪**：`imai-postgres`（postgres:16-alpine），凭据 `imai / imai_secret / db: imai`，5432 已映射；`domain/schema.sql` 已挂载至容器 `/schema.sql`
- **SQLite 全库仅 ~130 行**（task 28 / message 29 / audit 50 / 其余个位数），均为测试与演示痕迹
- deadline 全为文本短语（"周五前"/"下周一前"/"明天"）→ 证实双列过渡方案必要性
- psycopg/psycopg2 未安装

## 2. 目标形态

```text
imai/config.py      DATABASE_URL（默认沿用 IMAI_DB sqlite；postgresql:// 时启用 PG 后端）
imai/db.py          get_conn/init_db 按 scheme 分派：sqlite3 ｜ psycopg2
                    + to_pg(sql)：占位符 ? → %s 薄翻译（现有 SQL 无 ? 字面量，机械安全）
imai/repos.py 等    SQL 方言适配（约 20-30 处）：
                    INSERT OR IGNORE → ON CONFLICT DO NOTHING
                    INSERT OR REPLACE/ON CONFLICT UPDATE → ON CONFLICT DO UPDATE
                    datetime('now') → NOW()   ｜ date(col)=? → col::date=%s
                    lastrowid → INSERT ... RETURNING id（repos 写函数内分支）
domain/schema.sql   补齐缺口表：ai_dm / message / approval / role / event_dedup
                    + task 双列：deadline TEXT(原义) 与 deadline_at TIMESTAMPTZ(可空,由解析器回填)
tests/guard_pg/     真 Postgres 连 imai_test 库，跑方言等价核心用例（~8 条）
```

## 3. 数据迁移决策（S3-D1，待拍板）

**建议：不迁移旧数据，归档 `imai.db`**（`git mv` 后保留文件不入库路径）。理由：全部为测试痕迹（130 行），清洗成本（显示名→person_id 映射 + 人工确认清单）远超价值；Postgres 从 init_db 种子干净起步。迁移脚本（SQLite→PG 带映射清洗）作为附录工具延后到确有真实数据时再写。

## 4. 驱动选型决策（S3-D2，待拍板）

**建议：psycopg2 原生 SQL + 薄适配**，不引入 SQLAlchemy/Alembic。理由：现有 repos 全部手写 SQL，翻译方言即可复用；ORM 化是一次性大改且当前无多数据库诉求；Alembic 待表结构演进频繁时再上（报告原建议 SQLAlchemy+Alembic 的缩水版，诚实标注差异）。

## 5. 测试策略

| 层 | 方式 |
|---|---|
| Guard 存量（sync 26 + async 7） | 默认 SQLite，**必须原样全绿** |
| Guard PG（新增 tests/guard_pg/） | 连 `imai_test` 库（连接串 env IMAI_TEST_PG_URL），建表→跑核心用例→清库。覆盖：任务创建/确认/驳回、别名消歧、dedup 窗口、术语注入、每日汇总 |
| 冒烟 | `DATABASE_URL=postgresql://...imai` 起 uvicorn：登录/投消息/看板/审批全链路 |

## 6. 明确不做

❌ 数据清洗迁移脚本（附录延后）❌ SQLAlchemy/Alembic ❌ 连接池（单机 worker+api 各自短连接足够，psycopg2 自带简单池备选）❌ deadline 解析器实现（仅建双列，解析回填后续做）

## 7. 验收标准（DoD）

1. 双后端并存：`IMAI_DB`（SQLite）与 `DATABASE_URL=postgresql://`（PG）各自跑通核心闭环
2. guard / guard_async / guard_pg 三组全绿
3. PG 模式 uvicorn 冒烟：模拟消息→异步识别→看板确认→审计落 PG
4. 回滚：`.env` 移除 DATABASE_URL 即回 SQLite，数据零损失
