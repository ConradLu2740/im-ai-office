
import pytest

@pytest.fixture(autouse=True)
def _diag_worker_state():
    yield
    from imai import worker as _w, db as _d
    from imai.repos import audit_recent
    con = _d.get_conn()
    try:
        rows = audit_recent(con, 12)
        acts = [(r["action"], (r.get("detail") or "")[:60]) for r in rows]
        print("\n[A3-DIAG] audits:", acts[:6])
    finally:
        con.close()
