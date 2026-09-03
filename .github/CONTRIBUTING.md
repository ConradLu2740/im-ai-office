# 贡献指南 / Contributing

感谢关注 IMAI！欢迎以各种方式贡献：报告 Bug、提功能建议、改进文档、提交代码。

## 开发环境搭建 / Setup

要求：**Node.js ≥ 20**、**PostgreSQL ≥ 16**（唯一数据库，无 Docker / Python / Rust 依赖）。

```bash
git clone https://github.com/ConradLu2740/im-ai-office.git
cd im-ai-office/im-ai-office   # 代码在子目录
npm install                    # npm workspaces：backend-ts / frontend-ts / electron

cp .env.example .env           # 按需修改 DATABASE_URL / LLM 配置
```

本地开发：

```bash
npm run dev:backend    # 后端（tsx watch）
npm run dev:frontend   # 前端（esbuild watch）
npm run dev:electron   # 桌面壳
```

测试（需要本地建好 `imai_test` 库）：

```bash
psql -U postgres -c "CREATE USER imai WITH PASSWORD 'imai_secret' SUPERUSER;"  # 首次
psql -U postgres -c "CREATE DATABASE imai_test OWNER imai;"
npm test -w @imai/backend
```

## 开发约定 / Conventions

- **Spec 先行**：较大改动先在 `docs/specs/` 写设计说明（历史 Spec 都是很好的格式参考），小改动可直接开 PR。
- **三条设计底线**（违反则 PR 不会被合并）：
  1. AI 不擅自执行——确认/驳回必须人审兜底；
  2. 消息不丢不重——唯一约束幂等 + 双去重键；
  3. 数据不出域——一切落用户自己的数据库。
- **Schema 变更**只通过 drizzle 迁移，不手改已合入的迁移文件。
- AI 管线、消息链路的行为变更需附带测试（vitest，fake LLM 注入模式见 `tests/setup.ts`）。

## 提交 PR / Submitting PR

1. 从 `main` 拉分支；
2. 确保本地 typecheck / build / test 通过（CI 也会跑同样的检查）；
3. PR 描述说清动机与方案，关联对应 Issue。

## 许可 / License

提交即表示你同意代码以 [PolyForm Noncommercial 1.0.0](../LICENSE) 协议授权。
