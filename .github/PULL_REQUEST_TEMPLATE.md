### 变更说明 / What does this PR do?

<!-- 一两句话说明改了什么、为什么 -->

### 关联 Issue / Related issue

<!-- Closes #123 -->

### 自查清单 / Checklist

- [ ] `npm run typecheck -w @imai/backend && npm run typecheck -w @imai/frontend` 通过
- [ ] `npm test -w @imai/backend` 通过（涉及后端行为时）
- [ ] 涉及 AI 管线/消息链路时已补充或更新测试
- [ ] 涉及 schema 变更时已新增 drizzle 迁移，不手改已合入的迁移文件
- [ ] 遵守三条设计底线：AI 不擅自执行 / 消息不丢不重 / 数据不出域
