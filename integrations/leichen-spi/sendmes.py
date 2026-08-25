# -*- coding: utf-8 -*-
"""LeiChen AOI/SPI Python adapter for the Ruijing MES HTTP receiver."""

import json

import requests

import mesmodule


MES_URL = "http://192.168.6.155:8080/api/mes/spi/upload"


def updateUi():
    return json.dumps(
        {
            "constant": ["Factory", "Line", "Machine", "Operator"],
            "route": [],
        },
        ensure_ascii=False,
        indent=4,
    )


def _result(board_result, robot_result):
    if str(board_result).upper() == "FALSE":
        return "NG"
    if str(robot_result).upper() == "FALSE":
        return "REPASS"
    return "PASS"


def sendMes(jsonData):
    try:
        source = json.loads(jsonData)
        boards = list((source.get("data") or {}).values())
        constants = source.get("constants") or {}
        if not boards:
            raise ValueError("LeiChen payload contains no board data")

        first = boards[0]
        pcb_sn = str(first.get("PcbBarcode") or "").strip()
        if not pcb_sn:
            raise ValueError("LeiChen PcbBarcode is empty")

        board_data = []
        for index, board in enumerate(boards, 1):
            board_sn = str(board.get("Barcode") or "").strip()
            if not board_sn:
                continue
            board_data.append(
                {
                    "board_no": board.get("BoardNo", index),
                    "board_sn": board_sn,
                    "board_robot_result": _result(
                        board.get("RobotResult"), board.get("RobotResult")
                    ),
                    "board_user_result": _result(
                        board.get("BoardResult"), board.get("RobotResult")
                    ),
                    "board_final_result": _result(
                        board.get("BoardResult"), board.get("RobotResult")
                    ),
                }
            )

        payload = {
            "pcb_sn": pcb_sn,
            "pcb_project_name": first.get("ProjectName", ""),
            "pcb_test_time": first.get("DataTime", ""),
            "pcb_cycle_time": first.get("InspecTimeSrc", 0),
            "pcb_board_side": first.get("BoardSide", ""),
            "pcb_track_line": first.get("TrackIndex", 0),
            "pcb_robot_result": _result(
                first.get("RobotResult"), first.get("RobotResult")
            ),
            "pcb_user_result": _result(
                first.get("BoardResult"), first.get("RobotResult")
            ),
            "pcb_final_result": _result(
                first.get("BoardResult"), first.get("RobotResult")
            ),
            "device_name": constants.get("Machine") or "SPI-13",
            "factory": constants.get("Factory") or "RUIJING_VN",
            "line": constants.get("Line") or "SMT",
            "operator": constants.get("Operator") or "",
            "board_data": board_data,
        }
        response = requests.post(
            MES_URL,
            data=json.dumps(payload, ensure_ascii=False),
            headers={"Content-Type": "application/json"},
            timeout=(5, 20),
        )
        response_data = response.json()
        if response.status_code == 200 and str(response_data.get("code")) == "200":
            mesmodule.log.logger.info(
                "SPI MES upload accepted: pcb_sn=%s boards=%s",
                pcb_sn,
                len(board_data),
            )
            return json.dumps({"result": True, "msg": "ok"})
        raise RuntimeError(
            "MES rejected upload: HTTP {} {}".format(
                response.status_code, response.text
            )
        )
    except Exception as error:
        mesmodule.log.logger.exception("SPI MES upload failed: %s", error)
        return json.dumps({"result": False, "msg": str(error)}, ensure_ascii=False)


def callOtherFunc(_jsondata):
    return json.dumps({"result": True, "msg": "ok"})

