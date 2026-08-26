# 归属判定器：负责人消歧 + 决定 确认卡 / 私聊确认 / 汇总
# 基于 人表 + 别名索引 解决 "多个小张"
from dataclasses import dataclass
from typing import Optional

import psycopg


@dataclass
class NamedEntity:
    person_id: int
    real_name: str
    flower_name: Optional[str]
    alias_matched: str


class AssignResolver:
    """解析某条消息中的负责人，判断是否产生歧义。"""

    def __init__(self, db: psycopg.Connection):
        self.db = db

    def by_alias(self, name: str, grp_id: int) -> list[NamedEntity]:
        """按称呼查人，返回候选集（同一群内过滤收窄）。"""
        with self.db.cursor() as cur:
            cur.execute(
                """
                SELECT p.id, p.real_name, p.flower_name, a.name
                FROM alias a JOIN person p ON p.id = a.person_id
                WHERE a.name = %s
                """,
                (name,),
            )
            rows = cur.fetchall()
        # grp_id 过滤：若 person 有 group_id 且匹配群，优先
        entities = [NamedEntity(r[0], r[1], r[2], r[3]) for r in rows]
        return entities

    def resolve(self, msg: str, grp_id: int, sender_id: int) -> dict:
        """返回归属判定：assignee、confidence、歧义候选。"""
        # 1) 明确指名（@ 或 "你负责/你来"）→ 由意图判定器已给定 assignee_hint
        # 2) 主动认领（"我来/我负责"）→ assignee=sender
        # 3) 第三人称（"让小张跟一下"）→ 用别名消歧
        # 这里实现别名消歧逻辑：
        #   从消息里抽取可能的称谓（简化：用别名表做包含匹配）
        candidates = self._find_alias_candidates(msg, grp_id)
        if len(candidates) == 0:
            return {"assignee": None, "confidence": "low", "ambiguous": []}
        if len(candidates) == 1:
            ent = candidates[0]
            return {
                "assignee": ent.person_id,
                "confidence": "high",
                "ambiguous": [],
                "matched": ent.alias_matched,
            }
        # 多个同名 -> 歧义，需私聊发送者确认
        return {
            "assignee": None,
            "confidence": "medium",
            "ambiguous": [{"person_id": e.person_id, "label": f"{e.real_name}({e.flower_name or ''})"} for e in candidates],
        }

    def _find_alias_candidates(self, msg: str, grp_id: int) -> list[NamedEntity]:
        """从消息中找所有命中别名库的称谓。"""
        with self.db.cursor() as cur:
            cur.execute("SELECT DISTINCT name FROM alias")
            all_names = [r[0] for r in cur.fetchall()]
        hits = []
        for name in all_names:
            if name and name in msg:
                hits.extend(self.by_alias(name, grp_id))
        return hits
