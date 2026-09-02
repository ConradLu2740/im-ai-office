# IMAI · M3 权限前端可视化 Spec

> 时间：2026-09-02 ｜ 背景：M3 后端（角色/审批/审计）2026-08-23 已落地并验证（M3权限RBAC.md §8），但前端只有「审批」tab 的 pending 列表；产品一页纸 M3 标注"后续接入前端可视化"即指本缺口。
> 目标：管理员在网页端可见、可管：成员角色、审批历史、审计留痕。不做细粒度资源级权限（M3 Spec §7 范围裁剪不变）。

## 1. 范围

| 块 | 现状 | 本 Spec 交付 |
|---|---|---|
| 待审批列表 | ✅ 已有（审批 tab，仅 pending） | 加状态过滤（待审批/已批准/已拒绝）；非 pending 只读无按钮 |
| 成员角色 | ❌ 无界面（仅 API） | 新「权限」tab：role 表全量列表 + imAdmin 硬编码说明 + 设置表单（oim_user_id + 角色 + 保存） |
| 审计日志 | ❌ 无界面（GET /api/audit 已有） | 权限 tab 内审计列表（时间/角色/action/detail 摘要，limit=30） |

## 2. 后端增量（最小）

- `rbac.list_roles(con)`：`SELECT * FROM role ORDER BY oim_user_id`（role 表稀疏存储，未设置者默认 member，由前端文案说明）
- `GET /api/roles`：`{ok, roles: [...], imAdmin: "group_admin"}`；**只读不设防**（角色列表非敏感，与 /api/role/{id} 同级；写仍走 check_admin）

## 3. 前端

- board-tabs 新增「权限」tab（panel-rbac，data-loader=loadRbac）
- 角色卡：列表 + 表单；保存调 POST /api/role/set（沿用 api() 静默重签；admin token 未配置=内网无鉴权模式，行为与现状一致）
- 审计卡：/api/audit?limit=30 渲染；detail JSON 单行截断
- 审批 tab：status 过滤按钮组；loadApprovals(status) 通用化；仅 pending 渲染批准/拒绝按钮
- 同步规则：desktop/src 与 web/ 双份同步（改完 cp，dev.ps1 亦会同步）

## 4. 测试

- guard 增补：GET /api/roles 返回已设置角色 + imAdmin 说明；list_roles 只读
- 人工视觉项：权限 tab 渲染（沿用"仅剩这类需要人看"口径）

## 5. 明确不做

- 细粒度资源级权限、多级审批、组织架构树（沿用 M3 范围裁剪）
- person ↔ oim_user_id 关联展示（person 表无该列，属数据模型增量，另立）
