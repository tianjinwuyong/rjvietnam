import json
import tempfile
from pathlib import Path
import sys

SMT = Path(r"C:\Users\tianj\Desktop\越南工厂瑞晶\瑞晶越南工位-正式命名\001-SMT")
sys.path.insert(0, str(SMT))
from smt_station_agent import SmtStationAgent


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        config = {
            "domain": "smt", "lineCode": "L001", "stationCode": "smt_pda_loading",
            "stationIp": None, "sequence": 0, "nameZh": "PDA扫码上料",
            "nameEn": "PDA Material Loading", "nameVi": "Quét cấp liệu PDA",
            "sourceType": "scanner", "heartbeatSeconds": 10,
            "source": {"status": "pending", "path": "", "patterns": []},
            "mesUrl": "http://127.0.0.1:8080/api",
        }
        cfg = root / "station_config.json"
        cfg.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        agent = SmtStationAgent(cfg)
        agent.mes_json = lambda method, path, payload=None, timeout=8: {
            "success": True,
            "data": {
                "id": 1, "machine_code": payload["machineCode"],
                "work_order_code": payload["workOrderCode"], "status": "LOADING",
            },
        }
        try:
            agent.start_loading("WO-TEST", "OP-001")
            raise AssertionError("PCB SN gate must block loading without SPI SN")
        except ValueError as exc:
            assert "PCB SN" in str(exc)
        state = agent.start_loading(
            "WO-TEST", "OP-001", bypass_pcb_sn_binding=True,
            bypass_reason="SPI scanner maintenance", bypass_authorized_by="LEADER-01",
        )
        assert state["step"] == "MACHINE"
        state = agent.loading_scan("NPM-POS-01")
        assert state["step"] == "SLOT"
        assert state["session"]["machine_code"] == "NPM-POS-01"
        expected = [
            ("F01", "FEEDER"),
            ("FD08001", "REEL"),
            ("MAT-001,LOT-001,20260723", "OPERATOR"),
            ("OP-001", "CONFIRM"),
        ]
        for value, step in expected:
            state = agent.loading_scan(value)
            assert state["step"] == step, (value, state)
        draft = agent.loading_state()["draft"]
        assert draft == {
            "slotNo": "F01", "feederCode": "FD08001", "materialCode": "MAT-001",
            "lotNo": "LOT-001", "dateCode": "20260723", "operatorBadge": "OP-001",
        }
        print(json.dumps({"ok": True, "sequence": expected, "draft": draft}, ensure_ascii=False))


if __name__ == "__main__":
    main()
