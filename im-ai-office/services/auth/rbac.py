# RBAC 授权
# 核心：AI 作为独立主体(角色 ai-group-assistant)，读默认允许，写/外发/删除/付费分级授权。
# 矩阵：角色 -> 权限
ROLE_PERMISSIONS = {
    "group_member": {
        "read": True,
        "write_board": "own",        # 只能写与自己相关的
        "assign": False,
        "external": False,           # 外发/删除/付费
    },
    "group_admin": {
        "read": True,
        "write_board": True,
        "assign": True,
        "external": True,            # 管理员可选开启，需脱敏
    },
    "ai_group_assistant": {
        "read": True,                # 读群 = 必须（人机协同基础）
        "write_board": True,
        "assign": "require_approval",  # @派发需人审 / 被指派者可上诉
        "external": False,           # 默认禁，强制人工
    },
}


def can(role: str, perm: str) -> bool | str:
    """返回 True / False / 'own' / 'require_approval'。"""
    return ROLE_PERMISSIONS.get(role, {}).get(perm, False)


def check(role: str, perm: str) -> bool:
    res = can(role, perm)
    return res is True


def require_approval(role: str, perm: str) -> bool:
    """判断该操作是否需要人工批准。"""
    return can(role, perm) == "require_approval"
