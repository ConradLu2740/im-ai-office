# -*- coding: utf-8 -*-
"""IMAI 后端包（Step1 拆层重组产物）

分层（依赖单向）：api → services → (repos | integrations/config/db)
对外入口仍是根目录 app.py。
"""
