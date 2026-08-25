#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
autoline_manager.py — AutoLine 数据管理器

功能：
  1. HTTP API 接收 ICT/FCT 工位推送的测试数据（替代 MES）
  2. 文件监视器自动扫描 excels/ (ICT) 和 txts/ (FCT) 目录
  3. 写入 MySQL (imported_boards / imported_defects) → 看板读取
  4. 级联写入 line.db (SQLite) → 下游工位互通
  5. 板卡级 & 元件级数据完整入库

端口: 8080（与 ICT station.py 的 MES_NEW_API 兼容）

启动:
  python autoline_manager.py                    # 前台运行
  nohup python autoline_manager.py &            # 后台运行
"""

import argparse
import datetime
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
from http import HTTPStatus
from io import StringIO
from pathlib import Path

import flask
from flask import Flask, jsonify, request

# ================================================================
# 配置
# ================================================================

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, 'data') if 'smt-factory-system' in APP_DIR else APP_DIR

# CSV 目录（ICT ATE 测试报表）
ICT_WATCH_DIR = os.environ.get('ICT_WATCH_DIR',
    os.path.join(DATA_DIR, 'excels'))
# TXT 目录（FCT 功能测试数据）
FCT_WATCH_DIR = os.environ.get('FCT_WATCH_DIR',
    os.path.join(DATA_DIR, 'txts'))

# MySQL 连接
MYSQL_HOST = os.environ.get('MYSQL_HOST', '192.168.6.50')
MYSQL_PORT = int(os.environ.get('MYSQL_PORT', '3306'))
MYSQL_USER = os.environ.get('MYSQL_USER', 'mes')
MYSQL_PASS = os.environ.get('MYSQL_PASS', 'mes1234')
MYSQL_DB   = os.environ.get('MYSQL_DB', 'pcb_detection')

# SQLite line.db（产线级互通）
LINE_DB_PATH = os.environ.get('LINE_DB_PATH',
    os.path.join(DATA_DIR, 'line.db'))

# 监听端口
HTTP_PORT = int(os.environ.get('AUTOLINE_PORT', '8080'))

# 日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(APP_DIR, 'autoline_manager.log'), encoding='utf-8'),
    ]
)
logger = logging.getLogger('autoline')

# ================================================================
# MySQL 连接
# ================================================================

_mysql_pool = None
_mysql_lock = threading.Lock()

def _mysql_conn():
    """获取 MySQL 连接（复用）"""
    global _mysql_pool
    try:
        import mysql.connector
        if _mysql_pool is None or not _mysql_pool.is_connected():
            _mysql_pool = mysql.connector.connect(
                host=MYSQL_HOST, port=MYSQL_PORT,
                user=MYSQL_USER, password=MYSQL_PASS,
                database=MYSQL_DB, charset='utf8mb4',
                autocommit=False,
            )
        return _mysql_pool
    except Exception as e:
        logger.error(f'MySQL 连接失败: {e}')
        return None


def _mysql_exec(sql, params=None, fetch=True):
    """执行 SQL 并返回结果"""
    conn = _mysql_conn()
    if not conn:
        return None
    with _mysql_lock:
        try:
            cur = conn.cursor(dictionary=True)
            cur.execute(sql, params or ())
            if fetch:
                rows = cur.fetchall()
            else:
                conn.commit()
                rows = None
            cur.close()
            return rows
        except Exception as e:
            logger.error(f'MySQL 查询失败: {sql[:80]}... {e}')
            try:
                conn.rollback()
            except:
                pass
            return None


def _mysql_exec_many(sql, params_list):
    """批量执行"""
    conn = _mysql_conn()
    if not conn or not params_list:
        return 0
    with _mysql_lock:
        try:
            cur = conn.cursor()
            cur.executemany(sql, params_list)
            conn.commit()
            affected = cur.rowcount
            cur.close()
            return affected
        except Exception as e:
            logger.error(f'MySQL 批量写入失败: {e}')
            try:
                conn.rollback()
            except:
                pass
            return 0


def _ensure_imported_tables():
    """确保 imported_boards 和 imported_defects 表存在"""
    _mysql_exec("""
        CREATE TABLE IF NOT EXISTS imported_boards (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            batch_id BIGINT NOT NULL DEFAULT 0,
            source VARCHAR(32) NOT NULL DEFAULT '',
            board_sn VARCHAR(128) NOT NULL DEFAULT '',
            template VARCHAR(128) NOT NULL DEFAULT '',
            result VARCHAR(16) NOT NULL DEFAULT '',
            total_components INT NOT NULL DEFAULT 0,
            failed_components INT NOT NULL DEFAULT 0,
            test_time DATETIME,
            raw_data JSON,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_source (source),
            INDEX idx_board_sn (board_sn),
            INDEX idx_test_time (test_time),
            UNIQUE KEY uk_sn_source_time (board_sn, source, test_time)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """, fetch=False)

    _mysql_exec("""
        CREATE TABLE IF NOT EXISTS imported_defects (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            board_id BIGINT NOT NULL DEFAULT 0,
            source VARCHAR(32) NOT NULL DEFAULT '',
            component VARCHAR(128) NOT NULL DEFAULT '',
            measured VARCHAR(64) NOT NULL DEFAULT '',
            spec VARCHAR(128) NOT NULL DEFAULT '',
            test_result VARCHAR(16) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_board_id (board_id),
            INDEX idx_source (source),
            INDEX idx_component (component)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """, fetch=False)


# ================================================================
# SQLite (line.db) 写入
# ================================================================

def _line_conn():
    os.makedirs(os.path.dirname(LINE_DB_PATH) or '.', exist_ok=True)
    return sqlite3.connect(LINE_DB_PATH)


def _ensure_line_db():
    """确保 line.db 有 ng_pool 表"""
    conn = _line_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ng_pool (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station VARCHAR(32) NOT NULL DEFAULT '',
            sn VARCHAR(128) NOT NULL DEFAULT '',
            template VARCHAR(128) NOT NULL DEFAULT '',
            filename VARCHAR(500) NOT NULL DEFAULT '',
            result VARCHAR(16) NOT NULL DEFAULT '',
            total_components INTEGER NOT NULL DEFAULT 0,
            failed_components INTEGER NOT NULL DEFAULT 0,
            test_time DATETIME,
            raw_data JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            line_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            cleared INTEGER NOT NULL DEFAULT 0,
            cleared_at DATETIME,
            cleared_by VARCHAR(128),
            source VARCHAR(32) NOT NULL DEFAULT ''
        )
    """)
    conn.commit()
    cur.close()
    conn.close()


def _line_write_ng(station, record):
    """写入 line.db ng_pool（去重）"""
    _ensure_line_db()
    try:
        conn = _line_conn()
        cur = conn.cursor()
        sn = record.get('board_sn') or record.get('sn', '')
        test_time = record.get('test_time', '')
        source = record.get('source', station)
        cur.execute(
            "SELECT id FROM ng_pool WHERE station=? AND sn=? AND test_time=? AND source=?",
            (station, sn, str(test_time), source)
        )
        if cur.fetchone():
            cur.close()
            conn.close()
            return False
        raw = json.dumps(record, ensure_ascii=False, default=str)
        cur.execute("""
            INSERT INTO ng_pool
            (station, sn, template, filename, result, total_components, failed_components, test_time, raw_data, source)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            station,
            sn,
            record.get('template', ''),
            record.get('filename', ''),
            record.get('result', ''),
            record.get('total_components', 0),
            record.get('failed_components', 0),
            str(record.get('test_time', '')),
            raw,
            source,
        ))
        conn.commit()
        cur.close()
        conn.close()
        return True
    except Exception as e:
        logger.error(f'line.db 写入失败: {e}')
        return False


# ================================================================
# 文件解析
# ================================================================

def _parse_fct_csv(filepath):
    """解析 FCT CSV 文件 → board dict 或 None

    文件名格式: {template}_{SN}_{YYYYMMDDHHMMSS}_{PASS|FAIL}.CSV
    数据行从第4行开始, 23列, 逗号分隔
    """
    filename = os.path.basename(filepath)
    m = re.match(r'(.+?)_([A-Z0-9]+)_(\d{14})_(PASS|FAIL)\.CSV', filename, re.IGNORECASE)
    if not m:
        return None
    template, sn, ts_str, result = m.group(1), m.group(2), m.group(3), m.group(4)
    try:
        test_time = datetime.datetime.strptime(ts_str, '%Y%m%d%H%M%S')
    except:
        test_time = datetime.datetime.now()

    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.read().replace('\ufeff', '').strip().split('\n')
    except:
        return None

    if len(lines) < 4:
        return None

    components = []
    for line in lines[3:]:
        cols = line.strip().split(',')
        if len(cols) < 23:
            continue
        try:
            components.append({
                'station': cols[0].strip(),
                'item_no': cols[1].strip(),
                'component': cols[2].strip(),
                'type': cols[4].strip(),
                'measured': cols[10].strip(),
                'spec': cols[11].strip(),
                'test_result': cols[22].strip().upper(),
            })
        except (IndexError, ValueError):
            continue

    failed = sum(1 for c in components if c['test_result'] == 'FAIL')
    return {
        'board_sn': sn,
        'template': template,
        'test_time': test_time.strftime('%Y-%m-%d %H:%M:%S'),
        'result': result.upper(),
        'total_components': len(components),
        'failed_components': failed,
        'components': components,
        'filename': filename,
    }


def _parse_ict_txt(filepath):
    """解析 ICT TXT 文件 → board dict 或 None

    格式: SN:{sn} | {test_name}:{measured}:{PASS|FAIL}:{low}:{high} | ... | result:{PASS|FAIL}
    """
    filename = os.path.basename(filepath)
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read().replace('\ufeff', '')
    except:
        return None

    boards = []
    for line in content.strip().split('\n'):
        line = line.strip()
        if not line.startswith('SN:'):
            continue
        parts = line.split('|')
        if len(parts) < 3:
            continue
        sn = parts[0].replace('SN:', '').strip()
        last = parts[-1]
        overall = 'PASS' if ':PASS' in last else 'FAIL' if ':FAIL' in last else 'UNKNOWN'

        tests = []
        for item in parts[1:-1]:
            item = item.strip()
            if not item:
                continue
            cols = item.split(':')
            if len(cols) < 3:
                continue
            tests.append({
                'component': cols[0].strip(),
                'measured': cols[1].strip(),
                'test_result': cols[2].strip().upper(),
                'spec': f"{cols[3] if len(cols) > 3 else ''}~{cols[4] if len(cols) > 4 else ''}",
            })

        failed = sum(1 for t in tests if t['test_result'] == 'FAIL')
        boards.append({
            'board_sn': sn,
            'template': filename.replace('.txt', ''),
            'test_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'result': overall,
            'total_components': len(tests),
            'failed_components': failed,
            'components': tests,
            'filename': filename,
        })
    return boards if boards else None


# ================================================================
# MySQL 写入
# ================================================================

def _get_next_batch_id():
    """生成新的 batch_id"""
    result = _mysql_exec("SELECT COALESCE(MAX(batch_id), 0) + 1 as next_id FROM imported_boards")
    if result:
        return result[0]['next_id']
    return 1


def import_board(board, source, batch_id=None):
    """导入一块板的数据到 MySQL + line.db

    Args:
        board: dict with board_sn, template, test_time, result,
               total_components, failed_components, components (list)
        source: 'ict' 或 'fct'
        batch_id: 批次ID，None 则自动生成

    Returns:
        int: board_id (MySQL), 0=失败
    """
    if not board or not board.get('board_sn'):
        return 0

    _ensure_imported_tables()
    if batch_id is None:
        batch_id = _get_next_batch_id()

    sn = board['board_sn']
    result = board.get('result', 'UNKNOWN')
    test_time = board.get('test_time', '')

    # 写入 imported_boards (去重)
    raw_json = json.dumps(board, ensure_ascii=False, default=str)

    # 检查是否已存在
    existing = _mysql_exec(
        "SELECT id FROM imported_boards WHERE board_sn=%s AND source=%s AND test_time=%s",
        (sn, source, str(test_time))
    )
    if existing:
        logger.debug(f'  [跳过] {source} {sn} 已存在 (id={existing[0]["id"]})')
        return existing[0]['id']

    _mysql_exec("""
        INSERT INTO imported_boards
        (batch_id, source, board_sn, template, result, total_components, failed_components, test_time, raw_data)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        batch_id, source, sn,
        board.get('template', ''),
        result,
        board.get('total_components', 0),
        board.get('failed_components', 0),
        str(test_time) if test_time else None,
        raw_json,
    ), fetch=False)

    # 取回新插入的 ID
    new_id = _mysql_exec("SELECT LAST_INSERT_ID() as id")
    board_id = new_id[0]['id'] if new_id else 0

    # 写入 imported_defects (元件级)
    components = board.get('components', [])
    if components and board_id:
        defects = []
        for comp in components:
            if comp.get('test_result', '') in ('FAIL', 'PASS'):
                defects.append((
                    board_id, source,
                    comp.get('component', ''),
                    comp.get('measured', ''),
                    comp.get('spec', ''),
                    comp.get('test_result', ''),
                ))
        if defects:
            _mysql_exec_many(
                "INSERT INTO imported_defects (board_id, source, component, measured, spec, test_result) VALUES (%s,%s,%s,%s,%s,%s)",
                defects,
            )

    # 级联写入 line.db
    _line_write_ng(source, {**board, 'source': source})

    return board_id


def import_boards(boards, source, batch_id=None):
    """批量导入板卡数据"""
    count = 0
    errors = []
    if batch_id is None:
        batch_id = _get_next_batch_id()
    for board in boards:
        try:
            bid = import_board(board, source, batch_id)
            if bid:
                count += 1
        except Exception as e:
            errors.append({'sn': board.get('board_sn', ''), 'error': str(e)})
    logger.info(f'[import] {source}: {count}/{len(boards)} 导入成功')
    return {'count': count, 'total': len(boards), 'errors': errors, 'batch_id': batch_id}


# ================================================================
# 文件监视器
# ================================================================

_processed_files = set()
_file_watcher_running = False

def _watch_directory(watch_dir, source, parser, file_pattern):
    """监视目录，自动导入新文件

    Args:
        watch_dir: 目录路径
        source: 'ict' 或 'fct'
        parser: 解析函数，返回 board dict 或 list[board dict]
        file_pattern: 文件后缀 ('.CSV', '.txt')
    """
    if not os.path.isdir(watch_dir):
        os.makedirs(watch_dir, exist_ok=True)
        logger.info(f'[watcher] {source}: 创建目录 {watch_dir}')
        return

    files = sorted(os.listdir(watch_dir))
    new_count = 0
    for fname in files:
        if not fname.upper().endswith(file_pattern.upper()):
            continue
        fpath = os.path.join(watch_dir, fname)
        if not os.path.isfile(fpath):
            continue
        # 跳过已处理
        stat_key = f'{fname}_{os.path.getsize(fpath)}_{os.path.getmtime(fpath)}'
        if stat_key in _processed_files:
            continue

        logger.info(f'[watcher] {source}: 发现新文件 {fname}')
        try:
            parsed = parser(fpath)
            if parsed is None:
                logger.debug(f'[watcher] {source}: 跳过 {fname} (格式不匹配)')
                _processed_files.add(stat_key)
                continue
            # parser 可能返回 list 或 dict
            boards = parsed if isinstance(parsed, list) else [parsed]
            if not boards:
                _processed_files.add(stat_key)
                continue
            result = import_boards(boards, source)
            new_count += result['count']
            _processed_files.add(stat_key)
            if result['count'] > 0:
                logger.info(f'[watcher] {source}: {fname} → {result["count"]} 板')
        except Exception as e:
            logger.error(f'[watcher] {source}: 处理 {fname} 失败: {e}')

    if new_count > 0:
        logger.info(f'[watcher] {source}: 本轮导入 {new_count} 板')


def file_watcher_loop():
    """文件监视器后台循环"""
    global _file_watcher_running
    _file_watcher_running = True
    logger.info('[watcher] 文件监视器已启动')

    while _file_watcher_running:
        try:
            # ICT: 监视 excels/ 下的 CSV 文件
            _watch_directory(ICT_WATCH_DIR, 'ict', _parse_fct_csv, '.CSV')
            # FCT: 监视 txts/ 下的 TXT 文件
            _watch_directory(FCT_WATCH_DIR, 'fct', _parse_ict_txt, '.txt')
        except Exception as e:
            logger.error(f'[watcher] 扫描异常: {e}')
        # 每 15 秒扫描一次
        for _ in range(15):
            if not _file_watcher_running:
                break
            time.sleep(1)


def start_file_watcher():
    """启动文件监视器线程"""
    t = threading.Thread(target=file_watcher_loop, daemon=True, name='file-watcher')
    t.start()
    return t


def stop_file_watcher():
    """停止文件监视器"""
    global _file_watcher_running
    _file_watcher_running = False


# ================================================================
# Flask HTTP API
# ================================================================

app = Flask(__name__)
_start_time = datetime.datetime.now()


@app.route('/api/health', methods=['GET'])
def api_health():
    """健康检查"""
    mysql_ok = _mysql_conn() is not None
    return jsonify({
        'status': 'ok' if mysql_ok else 'degraded',
        'service': 'autoline-manager',
        'uptime': str(datetime.datetime.now() - _start_time),
        'mysql': 'connected' if mysql_ok else 'disconnected',
        'watcher': 'running' if _file_watcher_running else 'stopped',
    })


@app.route('/api/stats', methods=['GET'])
def api_stats():
    """数据统计"""
    source = request.args.get('source')
    if source:
        boards = _mysql_exec(
            "SELECT COUNT(*) as cnt, SUM(total_components) as comps, SUM(failed_components) as fails FROM imported_boards WHERE source=%s",
            (source,)
        )
        defects = _mysql_exec(
            "SELECT COUNT(*) as cnt FROM imported_defects WHERE source=%s",
            (source,)
        )
    else:
        boards = _mysql_exec(
            "SELECT source, COUNT(*) as cnt, SUM(total_components) as comps, SUM(failed_components) as fails FROM imported_boards GROUP BY source"
        )
        defects = _mysql_exec(
            "SELECT source, COUNT(*) as cnt FROM imported_defects GROUP BY source"
        )

    return jsonify({
        'boards': boards or [],
        'defects': defects or [],
        'uptime': str(datetime.datetime.now() - _start_time),
    })


@app.route('/api/v1/push', methods=['POST'])
def api_push():
    """接收工位推送事件 (兼容 ICT station.py mes_bridge_event 格式)

    POST JSON body:
    {
        "action": "station_scan",
        "payload": {
            "pcbSerial": "SN123",
            "stationCode": "ASM-ATE1-01",
            "machineCode": "ats231010.exe",
            "result": "PASS" | "FAIL"
        }
    }
    """
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({'error': '无效 JSON'}), 400

    if not data:
        return jsonify({'error': '空请求体'}), 400

    payload = data.get('payload', data)
    sn = payload.get('pcbSerial') or payload.get('pcbSerial') or payload.get('sn') or ''
    result = payload.get('result', 'UNKNOWN')
    station_code = payload.get('stationCode') or payload.get('station_code', '')

    if not sn:
        return jsonify({'error': '缺少 pcbSerial/sn'}), 400

    # 确定 source
    source = 'ict'
    if 'FCT' in station_code.upper() or 'FCT' in payload.get('machineCode', '').upper():
        source = 'fct'

    board = {
        'board_sn': sn,
        'template': payload.get('template', ''),
        'test_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'result': result.upper(),
        'total_components': int(payload.get('total_components', 0)),
        'failed_components': 1 if result.upper() == 'FAIL' else 0,
        'components': [],
        'filename': '',
    }

    bid = import_board(board, source)
    return jsonify({
        'status': 'ok',
        'board_id': bid,
        'source': source,
        'sn': sn,
    })


@app.route('/api/v1/board', methods=['POST'])
def api_add_board():
    """接收单板数据 (完整格式)

    POST JSON body:
    {
        "source": "ict" | "fct",
        "board_sn": "SN123",
        "template": "EPS48R1-36 TEST",
        "test_time": "2026-07-09 11:30:00",
        "result": "PASS" | "FAIL",
        "total_components": 108,
        "failed_components": 2,
        "components": [
            {"component": "R1", "measured": "10.2", "spec": "10", "test_result": "FAIL"},
            ...
        ]
    }
    """
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({'error': '无效 JSON'}), 400

    if not data:
        return jsonify({'error': '空请求体'}), 400

    source = data.get('source', 'ict')
    board = {
        'board_sn': data.get('board_sn', data.get('sn', '')),
        'template': data.get('template', ''),
        'test_time': data.get('test_time', datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')),
        'result': data.get('result', 'UNKNOWN').upper(),
        'total_components': int(data.get('total_components', 0) or 0),
        'failed_components': int(data.get('failed_components', 0) or 0),
        'components': data.get('components', data.get('defects', [])),
        'filename': data.get('filename', ''),
    }

    if not board['board_sn']:
        return jsonify({'error': '缺少 board_sn'}), 400

    bid = import_board(board, source)
    return jsonify({
        'status': 'ok',
        'board_id': bid,
        'source': source,
        'sn': board['board_sn'],
    })


@app.route('/api/v1/batch', methods=['POST'])
def api_add_batch():
    """批量导入板卡数据

    POST JSON body:
    {
        "source": "ict" | "fct",
        "boards": [...]
    }
    """
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({'error': '无效 JSON'}), 400

    source = data.get('source', 'ict')
    boards = data.get('boards', [])
    if not boards:
        return jsonify({'error': 'boards 为空'}), 400

    result = import_boards(boards, source)
    return jsonify(result)


@app.route('/api/v1/boards', methods=['GET'])
def api_list_boards():
    """查询已导入的板卡"""
    source = request.args.get('source')
    limit = int(request.args.get('limit', '100'))
    page = int(request.args.get('page', '1'))
    offset = (page - 1) * limit

    if source:
        rows = _mysql_exec(
            "SELECT id, source, board_sn, template, result, total_components, failed_components, test_time, created_at "
            "FROM imported_boards WHERE source=%s ORDER BY id DESC LIMIT %s OFFSET %s",
            (source, limit, offset)
        )
        total = _mysql_exec("SELECT COUNT(*) as cnt FROM imported_boards WHERE source=%s", (source,))
    else:
        rows = _mysql_exec(
            "SELECT id, source, board_sn, template, result, total_components, failed_components, test_time, created_at "
            "FROM imported_boards ORDER BY id DESC LIMIT %s OFFSET %s",
            (limit, offset)
        )
        total = _mysql_exec("SELECT COUNT(*) as cnt FROM imported_boards")

    return jsonify({
        'boards': rows or [],
        'total': total[0]['cnt'] if total else 0,
        'page': page,
        'limit': limit,
    })


@app.route('/api/v1/scan', methods=['POST'])
def api_scan_dir():
    """手动触发目录扫描"""
    source = request.args.get('source', 'all')
    results = {}

    if source in ('all', 'ict'):
        before = _mysql_exec("SELECT COUNT(*) as cnt FROM imported_boards WHERE source='ict'")
        _watch_directory(ICT_WATCH_DIR, 'ict', _parse_fct_csv, '.CSV')
        after = _mysql_exec("SELECT COUNT(*) as cnt FROM imported_boards WHERE source='ict'")
        results['ict'] = {
            'before': before[0]['cnt'] if before else 0,
            'after': after[0]['cnt'] if after else 0,
            'new': (after[0]['cnt'] if after else 0) - (before[0]['cnt'] if before else 0),
        }

    if source in ('all', 'fct'):
        before = _mysql_exec("SELECT COUNT(*) as cnt FROM imported_boards WHERE source='fct'")
        _watch_directory(FCT_WATCH_DIR, 'fct', _parse_ict_txt, '.txt')
        after = _mysql_exec("SELECT COUNT(*) as cnt FROM imported_boards WHERE source='fct'")
        results['fct'] = {
            'before': before[0]['cnt'] if before else 0,
            'after': after[0]['cnt'] if after else 0,
            'new': (after[0]['cnt'] if after else 0) - (before[0]['cnt'] if before else 0),
        }

    return jsonify({'status': 'ok', 'results': results})


# ================================================================
# 入口
# ================================================================

def main():
    parser = argparse.ArgumentParser(description='AutoLine 数据管理器')
    parser.add_argument('--port', type=int, default=HTTP_PORT, help='监听端口')
    parser.add_argument('--no-watcher', action='store_true', help='不启动文件监视器')
    parser.add_argument('--scan-once', action='store_true', help='扫描一次目录后退出')
    args = parser.parse_args()

    # 初始化数据库表
    _ensure_imported_tables()
    _ensure_line_db()
    logger.info('数据库表已就绪')

    # 启动文件监视器（后台线程）
    if not args.no_watcher:
        start_file_watcher()

    # 如果只扫描一次
    if args.scan_once:
        logger.info('扫描一次目录...')
        _watch_directory(ICT_WATCH_DIR, 'ict', _parse_fct_csv, '.CSV')
        _watch_directory(FCT_WATCH_DIR, 'fct', _parse_ict_txt, '.txt')
        summary = _mysql_exec("SELECT source, COUNT(*) as cnt FROM imported_boards GROUP BY source")
        logger.info(f'扫描完成: {summary}')
        return

    # 启动 Flask
    logger.info(f'AutoLine 管理器启动 → 0.0.0.0:{args.port}')
    logger.info(f'  ICT 数据目录: {ICT_WATCH_DIR}')
    logger.info(f'  FCT 数据目录: {FCT_WATCH_DIR}')
    logger.info(f'  MySQL: {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}')
    logger.info(f'  line.db: {LINE_DB_PATH}')
    logger.info(f'  API: http://0.0.0.0:{args.port}/api/health')

    app.run(host='0.0.0.0', port=args.port, debug=False, use_reloader=False)


if __name__ == '__main__':
    main()
