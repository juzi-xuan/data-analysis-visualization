# -*- coding: utf-8 -*-
"""
数据加载 + 聚合计算层
- load_data: 加载数据（模拟 / 上传）
- load_survey_data: 从 SQLite 读取问卷数据
- compute_*: 各种聚合计算，返回前端可用的 JSON 格式
"""

import io
import json
import os
import re
import random
import sqlite3
import pandas as pd
from datetime import datetime

from utils.mock_data import generate_canteen_data
from config.windows import WINDOW_CUISINE_MAP, WINDOW_INFO_MAP, WINDOWS


# 项目根目录
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# SQLite 数据库路径（项目根目录下 data/ 文件夹）
_DB_PATH = os.path.join(_PROJECT_ROOT, "data", "survey.db")

# 菜品配置 CSV 路径（自动查找第一个 CSV 文件，避免文件名空格/编码问题）
def _find_dishes_csv():
    form_dir = os.path.join(_PROJECT_ROOT, "static", "form")
    if not os.path.isdir(form_dir):
        return os.path.join(form_dir, "食堂窗口菜单价格表.csv")
    csv_files = [f for f in os.listdir(form_dir) if f.lower().endswith(".csv")]
    if csv_files:
        return os.path.join(form_dir, csv_files[0])
    return os.path.join(form_dir, "食堂窗口菜单价格表.csv")

_DISHES_CSV_PATH = _find_dishes_csv()


# ======================== 菜品数据加载 ========================

def load_dishes_from_csv(csv_path: str) -> dict:
    """
    读取菜品表（支持 CSV 和 Excel/xlsx 两种格式），返回 {窗口简称: [{"name": 菜品名, "price": float}, ...]}

    处理：ffill 窗口名 / 地点、价格去掉"元"转 float
    格式：先试 utf-8-sig CSV → gbk CSV → pd.read_excel 兜底
    读取异常时返回空 dict（不会 crash）
    """
    try:
        # 尝试 CSV（两种常见编码）
        try:
            df = pd.read_csv(csv_path, encoding="utf-8-sig")
        except UnicodeDecodeError:
            try:
                df = pd.read_csv(csv_path, encoding="gbk")
            except Exception:
                # CSV 都失败了 → 试试 Excel（有些文件扩展名是 .csv 但实际是 xlsx）
                df = pd.read_excel(csv_path)

        # ffill 窗口名和地点（表格里窗口名只在第一行写一次，后续行是 NaN）
        df["窗口名"] = df["窗口名"].ffill()

        dishes_by_window = {}
        for _, row in df.iterrows():
            # 空单元格 pandas 会读成 NaN，而 str(NaN) 会变成字符串 "nan"，
            # 直接落库就会出现名叫 "nan" 的菜品。必须先判掉空值。
            if pd.isna(row["窗口名"]) or pd.isna(row["餐品"]):
                continue
            window_short = str(row["窗口名"]).strip()
            dish_name = str(row["餐品"]).strip()
            if not window_short or not dish_name:
                continue
            price_raw = str(row["价格"]).strip()

            # 用正则提取价格里的第一个数字（兼容 "3.5元"/"3元"/"¥3.0"/"￥3" 等）
            nums = re.findall(r"[\d.]+", price_raw)
            if nums:
                try:
                    price = float(nums[0])
                except ValueError:
                    price = 0.0
            else:
                price = 0.0

            if window_short not in dishes_by_window:
                dishes_by_window[window_short] = []
            dishes_by_window[window_short].append({"name": dish_name, "price": price})

        return dishes_by_window
    except Exception as e:
        print(f"[WARN] 读取菜品表失败: {e}，窗口将保持无菜品选择器")
        return {}


# 窗口名错字/别名映射（图片名 → CSV名）
# 同时用于旧名→新名的迁移（处理已有的 SQLite 数据）
_WINDOW_ALIAS_MAP = {
    "里手混沌粉面": "里手馄饨粉面",  # "混沌" 是 "馄饨" 的错字
    "无名氏（一食堂一楼）": "无名氏（粉面手工）",
    # 旧名（二食堂，无楼层）→ 新名（二食堂一楼）
    "北方烤饼（二食堂）": "北方烤饼（二食堂一楼）",
    "王喜峰麻辣烫（二食堂）": "王喜峰麻辣烫（二食堂一楼）",
    "精品粮自选（二食堂）": "精品粮自选（二食堂一楼）",
    "黄焖鸡（二食堂）": "黄焖鸡（二食堂一楼）",
}

def _strip_parens(name: str) -> str:
    """去掉名称中括号里的内容，返回纯简称"""
    return re.sub(r'[（(].*?[）)]', '', name).strip()

def enrich_windows_with_dishes(windows: list, dishes_csv_path: str = None) -> list:
    """
    把 CSV 里的菜品合并到窗口列表里。
    匹配策略（按优先级）：
      1. 别名映射精确匹配（处理错字）
      2. CSV简称去掉括号 = 窗口简称去掉括号
      3. 双向包含匹配

    匹配不上的窗口不加 dishes 字段（保持老样子）。
    """
    if dishes_csv_path is None:
        dishes_csv_path = _DISHES_CSV_PATH

    dishes_by_short = load_dishes_from_csv(dishes_csv_path)
    if not dishes_by_short:
        return list(windows)  # 没数据就原样返回

    # 构建"去括号简称 → dishes"的映射（处理多对一）
    dishes_by_paren_stripped = {}
    for csv_full, dishes in dishes_by_short.items():
        key = _strip_parens(csv_full)
        dishes_by_paren_stripped.setdefault(key, []).extend(dishes)

    # 给每个匹配上的 window 加 dishes
    for window in windows:
        window_name = window["name"]
        window_short = _strip_parens(window_name)
        dishes_found = None

        # 策略 1: 别名映射
        alias_target = _WINDOW_ALIAS_MAP.get(window_name) or _WINDOW_ALIAS_MAP.get(window_short)
        if alias_target and alias_target in dishes_by_short:
            dishes_found = dishes_by_short[alias_target]

        # 策略 2: 去括号后的简称精确匹配
        if dishes_found is None and window_short in dishes_by_paren_stripped:
            dishes_found = dishes_by_paren_stripped[window_short]

        # 策略 3: 双向包含匹配（兜底）
        if dishes_found is None:
            for csv_full, dishes in dishes_by_short.items():
                csv_short = _strip_parens(csv_full)
                if csv_short in window_name or window_short in csv_full:
                    dishes_found = dishes
                    break

        if dishes_found:
            window["dishes"] = dishes_found

    return list(windows)


def ensure_survey_db():
    """确保 SQLite 数据库和表存在，自动迁移 dish_evaluations 列 + custom_dishes 表"""
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS survey_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            window_name TEXT NOT NULL,
            satisfaction INTEGER NOT NULL,
            tags TEXT,
            comment TEXT,
            submit_date TEXT NOT NULL,
            submitter_id TEXT,
            dish_evaluations TEXT
        )
    """)

    # 迁移：如果老表没有 dish_evaluations 列，就加上
    cursor = conn.execute("PRAGMA table_info(survey_responses)")
    existing_cols = [row[1] for row in cursor.fetchall()]
    if "dish_evaluations" not in existing_cols:
        conn.execute("ALTER TABLE survey_responses ADD COLUMN dish_evaluations TEXT")

    # ========== 自定义餐品表（用户添加的"其他"窗口） ==========
    conn.execute("""
        CREATE TABLE IF NOT EXISTS custom_dishes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_name TEXT NOT NULL,
            address TEXT,
            dish_name TEXT NOT NULL,
            cuisine TEXT DEFAULT '其他',
            image_path TEXT,
            description TEXT,
            submitter_id TEXT,
            submit_date TEXT NOT NULL,
            store_image_path TEXT
        )
    """)

    # 迁移：老表没有 store_image_path 列就加上
    cursor = conn.execute("PRAGMA table_info(custom_dishes)")
    existing_cols = [row[1] for row in cursor.fetchall()]
    if "store_image_path" not in existing_cols:
        conn.execute("ALTER TABLE custom_dishes ADD COLUMN store_image_path TEXT")

    # 给 (store_name, dish_name) 加唯一约束（兼容创建新表时一起建）
    try:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_store_dish ON custom_dishes (store_name, dish_name)")
    except sqlite3.OperationalError:
        pass

    # ========== 菜品展示图（一道菜一张，先到先得） ==========
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dish_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            window_name TEXT NOT NULL,
            dish_name TEXT NOT NULL,
            image_path TEXT NOT NULL,
            submitter_id TEXT,
            upload_date TEXT NOT NULL,
            UNIQUE(window_name, dish_name)
        )
    """)

    conn.commit()
    conn.close()


# ============================================================
# 菜品展示图
# 一道菜单独一张图（默认展示的是整个窗口的照片）。
# 表上加了 UNIQUE(window_name, dish_name)，从数据库层面保证
# 「一道菜只允许一张图」，避免多个同学重复上传。
# ============================================================

def load_dish_images() -> dict:
    """
    读取菜品展示图映射

    返回 {(窗口名, 菜品名): 图片路径}
    """
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        rows = conn.execute(
            "SELECT window_name, dish_name, image_path FROM dish_images"
        ).fetchall()
    finally:
        conn.close()
    return {(w, d): p for w, d, p in rows}


def save_dish_image(window_name: str, dish_name: str, image_path: str,
                    submitter_id: str = "") -> bool:
    """
    保存菜品展示图

    同一道菜已经有图时返回 False（既不覆盖也不新增）——
    这样第一个上传的同学的图会成为这道菜的固定展示图。
    """
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        exists = conn.execute(
            "SELECT 1 FROM dish_images WHERE window_name = ? AND dish_name = ?",
            (window_name, dish_name),
        ).fetchone()
        if exists:
            return False

        conn.execute(
            "INSERT INTO dish_images "
            "(window_name, dish_name, image_path, submitter_id, upload_date) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                window_name,
                dish_name,
                image_path,
                submitter_id,
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def save_survey_responses(responses: list, submitter_id: str = None) -> int:
    """
    保存一批问卷记录到 SQLite

    Args:
        responses: [{"window_name": str, "satisfaction": int, "tags": [], "comment": str,
                     "dish_evaluations": [{"name": str, "price": float, "description": str}]}]
        submitter_id: 可选的匿名用户标识

    Returns:
        成功保存的条数
    """
    ensure_survey_db()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = sqlite3.connect(_DB_PATH)
    try:
        for r in responses:
            conn.execute(
                "INSERT INTO survey_responses "
                "(window_name, satisfaction, tags, comment, dish_evaluations, submit_date, submitter_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    r["window_name"],
                    int(r["satisfaction"]),
                    json.dumps(r.get("tags", []), ensure_ascii=False),
                    r.get("comment", ""),
                    json.dumps(r.get("dish_evaluations", []), ensure_ascii=False),
                    now,
                    submitter_id,
                ),
            )
        conn.commit()
        return len(responses)
    finally:
        conn.close()


def load_custom_dishes() -> list:
    """从 custom_dishes 表读取所有用户添加的餐品，按店分组返回 list[store_dict]

    每个 store_dict 结构：
    {
        "store_name": str,
        "address": str,
        "cuisine": str,
        "store_image_path": str,
        "store_description": str,   # 首道添加的人写的介绍
        "first_submit_date": str,
        "dishes": [
            {"id", "dish_name", "image_path", "description", "submit_date"},
            ...
        ]
    }
    """
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        rows = conn.execute(
            "SELECT id, store_name, address, dish_name, cuisine, image_path, "
            "description, submit_date, store_image_path "
            "FROM custom_dishes ORDER BY store_name, id"
        ).fetchall()
    finally:
        conn.close()

    stores = {}  # store_name -> store_dict
    for r in rows:
        id_, store_name, address, dish_name, cuisine, image_path, desc, submit_date, store_img = r
        if store_name not in stores:
            stores[store_name] = {
                "store_name": store_name,
                "address": address or "",
                "cuisine": cuisine or "其他",
                "store_image_path": store_img or "",
                "store_description": desc or "",
                "first_submit_date": submit_date,
                "dishes": [],
            }
        # 后续同店新增的菜如果补了 address/store_image，也更新
        store = stores[store_name]
        if address and not store["address"]:
            store["address"] = address
        if store_img and not store["store_image_path"]:
            store["store_image_path"] = store_img

        store["dishes"].append({
            "id": id_,
            "dish_name": dish_name,
            "image_path": image_path or "",
            "description": desc or "",
            "submit_date": submit_date,
        })

    return list(stores.values())


def search_custom_stores(keyword: str = "", limit: int = 15) -> list:
    """搜索匹配的自定义店子（按店名模糊匹配），按 store_name 去重"""
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        if keyword:
            rows = conn.execute(
                "SELECT store_name, address, cuisine, store_image_path "
                "FROM custom_dishes "
                "WHERE store_name LIKE ? "
                "ORDER BY store_name, id LIMIT ?",
                (f"%{keyword}%", limit * 3),  # 多取一点保证过滤去重后够 limit 条
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT store_name, address, cuisine, store_image_path "
                "FROM custom_dishes "
                "ORDER BY store_name, id LIMIT ?",
                (limit * 3,),
            ).fetchall()
    finally:
        conn.close()

    # 按 store_name 去重：取第一条非空 address/cuisine/store_image_path
    seen = {}
    for name, addr, cuisine, img in rows:
        if name not in seen:
            seen[name] = {
                "store_name": name,
                "address": addr or "",
                "cuisine": cuisine or "其他",
                "store_image_path": img or "",
            }
        else:
            s = seen[name]
            if addr and not s["address"]:
                s["address"] = addr
            if img and not s["store_image_path"]:
                s["store_image_path"] = img

    return list(seen.values())[:limit]


def get_store_by_name(store_name: str) -> dict | None:
    """按精确店名查自定义店（用于加菜时校验店是否存在）"""
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        row = conn.execute(
            "SELECT store_name, address, cuisine, store_image_path "
            "FROM custom_dishes WHERE store_name = ? LIMIT 1",
            (store_name,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {
        "store_name": row[0],
        "address": row[1] or "",
        "cuisine": row[2] or "其他",
        "store_image_path": row[3] or "",
    }


def ensure_store_image(store_name: str, image_path: str) -> bool:
    """给某个店子补一张店图（如果还没有），更新所有同店记录的 store_image_path"""
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        existing = conn.execute(
            "SELECT 1 FROM custom_dishes WHERE store_name = ? AND store_image_path IS NOT NULL AND store_image_path != '' LIMIT 1",
            (store_name,),
        ).fetchone()
        if existing:
            return False
        conn.execute(
            "UPDATE custom_dishes SET store_image_path = ? WHERE store_name = ? AND (store_image_path IS NULL OR store_image_path = '')",
            (image_path, store_name),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def load_survey_data() -> pd.DataFrame:
    """
    从 SQLite 读取问卷数据 + 自定义餐品数据，转换成看板需要的 DataFrame 格式

    核心逻辑变更：
        - dish_evaluations 有内容 → 每个菜品展开成独立行
        - dish_evaluations 为空 → fallback "窗口综合"
        - custom_dishes 表里的餐品也合并进来
    """
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        df = pd.read_sql_query(
            "SELECT window_name, satisfaction, tags, comment, dish_evaluations, submit_date FROM survey_responses",
            conn,
        )
        custom_rows = conn.execute(
            "SELECT store_name, address, dish_name, cuisine, description, submit_date FROM custom_dishes"
        ).fetchall()
    finally:
        conn.close()

    records = []

    # ========== 1. 问卷评价数据 ==========
    if not df.empty:
        for _, row in df.iterrows():
            window_name = row["window_name"]
            window_name = _WINDOW_ALIAS_MAP.get(window_name, window_name)
            score = float(row["satisfaction"])
            date_str = row["submit_date"][:10]
            cuisine = WINDOW_CUISINE_MAP.get(window_name, "")

            try:
                tag_list = json.loads(row["tags"]) if row["tags"] else []
            except (json.JSONDecodeError, TypeError):
                tag_list = []

            try:
                dish_evals = json.loads(row["dish_evaluations"]) if row["dish_evaluations"] else []
            except (json.JSONDecodeError, TypeError):
                dish_evals = []

            base_parts = []
            if tag_list:
                base_parts.append("、".join(tag_list))
            if row["comment"]:
                base_parts.append(row["comment"])

            if dish_evals:
                for dish in dish_evals:
                    # "nan" / "none" 是历史数据里序列化空值留下的脏字符串，
                    # 语义上等于"没填菜名"，统一按空处理，走下面的「窗口综合」兜底
                    dish_name = str(dish.get("name") or "").strip()
                    if dish_name.lower() in ("nan", "none", "null"):
                        dish_name = ""
                    try:
                        price = float(dish.get("price", 0))
                    except (ValueError, TypeError):
                        price = 0.0
                    dish_desc = dish.get("description", "")
                    dish_tags = dish.get("tags", [])
                    all_tags = list(set(tag_list + dish_tags))

                    text_parts = list(base_parts)
                    if dish_tags:
                        text_parts.append("、".join(dish_tags))
                    if dish_desc:
                        text_parts.append(dish_desc)

                    records.append({
                        "窗口名": window_name,
                        "菜品名": dish_name or "窗口综合",
                        "菜系类型": cuisine,
                        "评分": score,
                        "价格": price if price > 0 else "",
                        "评价文字": " | ".join(text_parts) if text_parts else "",
                        "日期": date_str,
                        "tags": json.dumps(all_tags, ensure_ascii=False),
                        "是否投票": bool(dish.get("voted", False)),
                    })
            else:
                records.append({
                    "窗口名": window_name,
                    "菜品名": "窗口综合",
                    "菜系类型": cuisine,
                    "评分": score,
                    "价格": "",
                    "评价文字": " | ".join(base_parts) if base_parts else "",
                    "日期": date_str,
                    "tags": json.dumps(tag_list, ensure_ascii=False),
                    "是否投票": False,
                })

    # ========== 2. 自定义餐品数据合并 ==========
    for r in custom_rows:
        store_name, address, dish_name, cuisine, desc, submit_date = r
        text_parts = []
        if address:
            text_parts.append(f"📍地址：{address}")
        if desc:
            text_parts.append(desc)

        records.append({
            "窗口名": store_name,
            "菜品名": dish_name,
            "菜系类型": cuisine or "其他",
            # 自定义餐品本身没有评分（评分通过 survey_responses 累积）。
            # 这里必须用 NaN 而不是 ""：一旦混入字符串，
            # 整列「评分」的 dtype 会退化成 object，
            # 后面所有 groupby(...).mean() / astype(float) 都会直接报错。
            "评分": float("nan"),
            "价格": "",
            "评价文字": " | ".join(text_parts) if text_parts else "",
            "日期": submit_date[:10] if submit_date else "",
            "tags": json.dumps([], ensure_ascii=False),
            "是否投票": False,
        })

    if not records:
        return pd.DataFrame(
            columns=["窗口名", "菜品名", "菜系类型", "评分", "价格", "评价文字", "日期", "tags", "是否投票"]
        )

    return pd.DataFrame(records)


def load_data(uploaded_file=None) -> pd.DataFrame:
    """
    加载数据

    Args:
        uploaded_file: Flask request.files 中的文件对象（可为 None）

    Returns:
        pandas DataFrame，字段：窗口名、菜品名、菜系类型、评分、价格、评价文字、日期
    """
    if uploaded_file is None:
        # 默认用模拟数据
        return generate_canteen_data(200)

    # 从上传文件读取
    filename = uploaded_file.filename.lower()
    file_data = uploaded_file.read()

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(file_data))
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(file_data))
        else:
            raise ValueError(f"不支持的文件类型: {filename}")

        # 基本字段校验：确保核心列存在，不存在就尝试重命名
        required_cols = ["窗口名", "菜品名", "评分"]
        missing = [c for c in required_cols if c not in df.columns]
        if missing:
            # 尝试模糊匹配，比如 "评分" → "总体评分"
            rename_map = {}
            for col in df.columns:
                for req in missing:
                    if req in col or col in req:
                        rename_map[col] = req
            if rename_map:
                df = df.rename(columns=rename_map)
            else:
                # 还是缺，就用模拟数据兜底
                print(f"上传文件缺少必要字段 {missing}，回退到模拟数据")
                return generate_canteen_data(200)

        # 补齐可选字段
        optional_cols = ["菜系类型", "价格", "评价文字", "日期"]
        for col in optional_cols:
            if col not in df.columns:
                df[col] = ""  # 缺失就填空字符串

        return df

    except Exception as e:
        print(f"读取上传文件失败: {e}，回退到模拟数据")
        return generate_canteen_data(200)


def apply_filters(df: pd.DataFrame, search: str = "", cuisine: str = "") -> pd.DataFrame:
    """根据搜索关键词和菜系类型筛选数据"""
    if search:
        mask = (
            df["菜品名"].astype(str).str.contains(search, na=False)
            | df["窗口名"].astype(str).str.contains(search, na=False)
            | df["评价文字"].astype(str).str.contains(search, na=False)
        )
        df = df[mask]

    if cuisine and cuisine != "全部":
        df = df[df["菜系类型"] == cuisine]

    return df.reset_index(drop=True)


# ======================== 聚合计算函数 ========================

def compute_stats(df: pd.DataFrame) -> dict:
    """计算统计卡片数据"""
    if df.empty:
        return {
            "total": 0,
            "avg_score": 0,
            "best_window": {"name": "-", "score": 0},
            "worst_window": {"name": "-", "score": 0},
            "score_delta_best": 0,
            "score_delta_worst": 0,
        }

    total = len(df)
    avg_score = round(df["评分"].mean(), 2)

    # 各窗口平均分
    window_avg = df.groupby("窗口名")["评分"].mean()
    best_name = window_avg.idxmax()
    worst_name = window_avg.idxmin()
    best_score = round(window_avg[best_name], 2)
    worst_score = round(window_avg[worst_name], 2)

    return {
        "total": total,
        "avg_score": avg_score,
        "best_window": {"name": best_name, "score": best_score},
        "worst_window": {"name": worst_name, "score": worst_score},
        "score_delta_best": round(best_score - avg_score, 2),
        "score_delta_worst": round(worst_score - avg_score, 2),
    }


def compute_window_avg(df: pd.DataFrame) -> list:
    """各窗口平均分（降序），返回 [{name, value}]"""
    if df.empty:
        return []
    result = (
        df.groupby("窗口名")["评分"]
        .mean()
        .round(2)
        .sort_values(ascending=False)
        .reset_index()
    )
    return [{"name": row["窗口名"], "value": row["评分"]} for _, row in result.iterrows()]


def compute_score_dist(df: pd.DataFrame) -> list:
    """评分分布（1-5 星），返回 [{name, value}]"""
    if df.empty:
        return []
    # 取整星
    scores = df["评分"].apply(lambda x: int(x) if pd.notna(x) else 0)
    dist = scores.value_counts().reindex([1, 2, 3, 4, 5], fill_value=0)
    return [{"name": f"{i}星", "value": int(dist.get(i, 0))} for i in [5, 4, 3, 2, 1]]


def compute_window_rank(df: pd.DataFrame) -> list:
    """窗口热度排行（前 10 个，按评价数量），返回 [{name, value}]"""
    if df.empty:
        return []
    result = (
        df.groupby("窗口名")
        .size()
        .sort_values(ascending=False)
        .head(10)
        .reset_index()
    )
    result.columns = ["name", "value"]
    return [{"name": row["name"], "value": int(row["value"])} for _, row in result.iterrows()]


def compute_cuisine_score(df: pd.DataFrame) -> list:
    """菜系类型平均分，返回 [{name, value}]"""
    if df.empty or "菜系类型" not in df.columns:
        return []
    result = (
        df.groupby("菜系类型")["评分"]
        .mean()
        .round(2)
        .sort_values(ascending=False)
        .reset_index()
    )
    return [{"name": row["菜系类型"], "value": row["评分"]} for _, row in result.iterrows()]


def compute_price_scatter(df: pd.DataFrame) -> dict:
    """价格 vs 评分散点图数据"""
    if df.empty or "价格" not in df.columns:
        return {"data": [], "cuisines": []}

    cuisines = df["菜系类型"].unique().tolist()

    # 按菜系分组，每组一个 series
    series_data = []
    for cuisine in cuisines:
        sub = df[df["菜系类型"] == cuisine]
        points = []
        for _, row in sub.iterrows():
            try:
                price = float(row["价格"])
                score = float(row["评分"])
                points.append([price, score])
            except (ValueError, TypeError):
                continue
        if points:
            series_data.append({"name": cuisine, "data": points})

    return {"data": series_data, "cuisines": cuisines}


def compute_table_data(
    df: pd.DataFrame, page: int = 1, size: int = 20
) -> dict:
    """分页获取原始数据"""
    total = len(df)
    start = (page - 1) * size
    end = start + size

    # 列名映射成中文友好的
    cols = ["窗口名", "菜品名", "菜系类型", "评分", "价格", "评价文字", "日期"]
    cols_exist = [c for c in cols if c in df.columns]
    sub = df[cols_exist].iloc[start:end]

    # 转成 list[dict]
    rows = sub.where(pd.notnull(sub), None).to_dict(orient="records")

    return {
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size,
        "rows": rows,
    }


def compute_data_date(df: pd.DataFrame) -> str:
    """获取数据的更新时间描述"""
    if "日期" in df.columns:
        dates = pd.to_datetime(df["日期"], errors="coerce").dropna()
        if not dates.empty:
            return dates.max().strftime("%Y-%m-%d")
    return datetime.now().strftime("%Y-%m-%d")


# ======================== 分析看板专用聚合函数 ========================

# 食堂归属映射（从 WINDOWS 中提取：窗口名 → 食堂）
_CANTEEN_MAP = {w["name"]: w["canteen"] for w in WINDOWS}


def _add_canteen_col(df: pd.DataFrame) -> pd.DataFrame:
    """给 DataFrame 补上 '食堂' 列（基于窗口名匹配）"""
    if "食堂" in df.columns:
        return df
    df = df.copy()
    df["食堂"] = df["窗口名"].map(_CANTEEN_MAP).fillna("未知")
    return df


def compute_trend(df: pd.DataFrame) -> dict:
    """
    评分时间趋势：按日期聚合平均分 + 样本量
    返回 { dates: [...], avg_scores: [...], counts: [...] }
    """
    if df.empty or "日期" not in df.columns:
        return {"dates": [], "avg_scores": [], "counts": []}

    df = df.copy()
    df["日期_dt"] = pd.to_datetime(df["日期"], errors="coerce")
    df = df.dropna(subset=["日期_dt"])

    if df.empty:
        return {"dates": [], "avg_scores": [], "counts": []}

    grouped = (
        df.groupby(df["日期_dt"].dt.strftime("%Y-%m-%d"))["评分"]
        .agg(["mean", "count"])
        .round({"mean": 2})
        .reset_index()
    )
    grouped.columns = ["date", "avg_score", "count"]
    grouped = grouped.sort_values("date")

    return {
        "dates": grouped["date"].tolist(),
        "avg_scores": grouped["avg_score"].tolist(),
        "counts": grouped["count"].astype(int).tolist(),
    }


def compute_canteen_compare(df: pd.DataFrame) -> list:
    """
    一食堂 vs 二食堂 对比
    返回 [{"canteen": "一食堂", "avg_score": 3.65, "count": 50, "window_count": 3}, ...]
    """
    if df.empty or "窗口名" not in df.columns:
        return []

    df = _add_canteen_col(df)
    df = df[df["食堂"] != "未知"]

    if df.empty:
        return []

    # 每个食堂的平均分 + 样本量 + 覆盖窗口数
    result = (
        df.groupby("食堂")
        .agg(
            avg_score=("评分", "mean"),
            count=("评分", "size"),
            window_count=("窗口名", "nunique"),
        )
        .round({"avg_score": 2})
        .reset_index()
        .sort_values("食堂")
    )

    return [
        {
            "canteen": row["食堂"],
            "avg_score": row["avg_score"],
            "count": int(row["count"]),
            "window_count": int(row["window_count"]),
        }
        for _, row in result.iterrows()
    ]


def compute_sentiment(df: pd.DataFrame) -> list:
    """
    正负情感标签占比（基于评价文字中是否包含负向关键词）
    返回 [{"name": "好评", "value": 65}, {"name": "中评", "value": 20}, {"name": "差评", "value": 15}]

    规则：
      - 评价文字中包含任一个 NEGATIVE_TAGS 关键词 → 差评
      - 否则 → 好评
      （简化版：二分类）
    """
    from config.windows import NEGATIVE_TAGS

    if df.empty or "评价文字" not in df.columns:
        return []

    negative_keywords = [t.replace("⚠️", "").replace("❌", "").replace("💧", "")
                         .replace("🍜", "").replace("💸", "").replace("😵", "")
                         .replace("🥶", "").replace("🪳", "")
                         for t in NEGATIVE_TAGS]
    negative_keywords = [k for k in negative_keywords if k.strip()]

    def has_negative(text):
        text = str(text)
        for kw in negative_keywords:
            if kw in text:
                return True
        return False

    df = df.copy()
    df["has_neg"] = df["评价文字"].apply(has_negative)

    total = len(df)
    neg_count = int(df["has_neg"].sum())
    pos_count = total - neg_count

    return [
        {"name": "好评", "value": pos_count, "color": "#6AB04C"},
        {"name": "差评", "value": neg_count, "color": "#E85D75"},
    ]


def compute_analysis_stats(df: pd.DataFrame) -> dict:
    """
    分析师视角统计量
    - 总样本量、有效窗口数、食堂数量
    - 平均评分、标准差、中位数、变异系数(CV)
    - 价格统计（平均价、中位价、最高/最低价）
    - 时间跨度（最早~最晚）
    - 评分分布偏度、是否左偏
    - 价格-评分 Pearson 相关系数
    """
    if df.empty:
        return {
            "total": 0,
            "window_count": 0,
            "canteen_count": 0,
            "avg_score": 0,
            "std_score": 0,
            "median_score": 0,
            "cv_score": 0,
            "avg_price": 0,
            "median_price": 0,
            "min_price": 0,
            "max_price": 0,
            "date_range": "",
            "skew": 0,
            "correlation": 0,
            "insights": [],
        }

    df = _add_canteen_col(df)

    scores = df["评分"].astype(float)
    avg_score = round(scores.mean(), 2)
    std_score = round(scores.std(), 2) if len(scores) > 1 else 0
    median_score = round(scores.median(), 2)
    cv_score = round(std_score / avg_score, 3) if avg_score > 0 else 0
    skew = round(scores.skew(), 2)

    # 价格统计（去掉空值和0）
    prices = pd.to_numeric(df["价格"], errors="coerce").dropna()
    prices = prices[prices > 0]
    if len(prices) > 0:
        avg_price = round(prices.mean(), 2)
        median_price = round(prices.median(), 2)
        min_price = round(prices.min(), 2)
        max_price = round(prices.max(), 2)
    else:
        avg_price = median_price = min_price = max_price = 0

    # 时间跨度
    dates = pd.to_datetime(df["日期"], errors="coerce").dropna()
    if not dates.empty:
        date_range = f"{dates.min().strftime('%Y-%m-%d')} ~ {dates.max().strftime('%Y-%m-%d')}"
    else:
        date_range = "-"

    # 价格-评分 Pearson 相关系数
    corr = 0
    df_clean = df.copy()
    df_clean["价格_num"] = pd.to_numeric(df_clean["价格"], errors="coerce")
    df_clean = df_clean.dropna(subset=["价格_num", "评分"])
    df_clean = df_clean[df_clean["价格_num"] > 0]
    if len(df_clean) >= 3:
        corr = round(df_clean["价格_num"].corr(df_clean["评分"]), 3)

    # 食堂 & 窗口
    canteen_count = int(df[df["食堂"] != "未知"]["食堂"].nunique())
    window_count = int(df["窗口名"].nunique())

    # 自动洞察摘要
    insights = []
    # 1. 总体概览
    insights.append(
        f"共收集 **{len(df)}** 条有效评价，覆盖 **{canteen_count}** 个食堂、**{window_count}** 个窗口"
    )

    # 2. 分布特征
    if std_score > 0:
        if abs(skew) < 0.3:
            skew_desc = "近似正态分布"
        elif skew < 0:
            skew_desc = "左偏（整体评分偏高）"
        else:
            skew_desc = "右偏（存在低分拖尾）"
        insights.append(
            f"整体评分 **{avg_score} ± {std_score}**，{skew_desc}"
        )

    # 3. 食堂对比
    canteen_stats = df[df["食堂"] != "未知"].groupby("食堂")["评分"].agg(["mean", "count"])
    if len(canteen_stats) >= 2:
        best_canteen = canteen_stats["mean"].idxmax()
        worst_canteen = canteen_stats["mean"].idxmin()
        diff = round(canteen_stats["mean"].max() - canteen_stats["mean"].min(), 2)
        if diff > 0.1:
            insights.append(
                f"🏗️ **{best_canteen}** 平均评分 ({round(canteen_stats['mean'].max(), 2)}) "
                f"显著高于 **{worst_canteen}** ({round(canteen_stats['mean'].min(), 2)})"
            )

    # 4. 价格-评分相关
    if abs(corr) >= 0.1:
        if corr > 0:
            corr_desc = "弱正相关" if corr < 0.3 else "中等正相关"
            insights.append(
                f"💰 价格与评分呈{corr_desc} (r={corr})，高价窗口普遍评分更高"
            )
        else:
            insights.append(
                f"💰 价格与评分呈弱负相关 (r={corr})，贵的不一定好吃"
            )

    # 5. 价格统计
    if avg_price > 0:
        insights.append(
            f"💰 菜品均价 **¥{avg_price}**，价格区间 ¥{min_price} ~ ¥{max_price}"
        )

    # 6. 时间趋势
    trend_result = compute_trend(df)
    if len(trend_result["dates"]) >= 3:
        scores_series = trend_result["avg_scores"]
        first_half = sum(scores_series[:len(scores_series) // 2]) / max(1, len(scores_series) // 2)
        second_half = sum(scores_series[len(scores_series) // 2:]) / max(1, len(scores_series) - len(scores_series) // 2)
        diff_trend = round(second_half - first_half, 2)
        if abs(diff_trend) < 0.05:
            insights.append(f"📈 近 {len(trend_result['dates'])} 天评分趋势平稳")
        elif diff_trend > 0:
            insights.append(f"📈 评分呈上升趋势（+{diff_trend}），食堂质量在变好")
        else:
            insights.append(f"📈 评分呈下降趋势（{diff_trend}），值得关注")

    return {
        "total": int(len(df)),
        "window_count": window_count,
        "canteen_count": canteen_count,
        "avg_score": avg_score,
        "std_score": std_score,
        "median_score": median_score,
        "cv_score": cv_score,
        "avg_price": avg_price,
        "median_price": median_price,
        "min_price": min_price,
        "max_price": max_price,
        "date_range": date_range,
        "skew": skew,
        "correlation": corr,
        "insights": insights,
    }


def compute_student_summary(df: pd.DataFrame) -> dict:
    """
    学生决策看板专用汇总数据
    返回 {
        best_window: {name, score, reason}       # 推荐首选：score * log(count) 加权
        hot_window:  {name, count}               # 人气王：评价数最多
        value_window:{name, score, avg_price}    # 性价比之选：高评分 + 适中价格
        warn_window: {name, score, count}        # 避雷预警：样本量足够前提下分最低
        total_count: int
    }
    """
    if df.empty:
        return {
            "best_window": {"name": "暂无数据", "score": "-", "reason": ""},
            "hot_window": {"name": "暂无数据", "count": 0},
            "value_window": {"name": "暂无数据", "score": "-", "avg_price": "-"},
            "warn_window": {"name": "暂无数据", "score": "-", "count": 0},
            "total_count": 0,
        }

    import math

    # 各窗口聚合
    grouped = df.groupby("窗口名").agg(
        avg_score=("评分", "mean"),
        count=("评分", "size"),
        avg_price=("价格", lambda x: pd.to_numeric(x, errors="coerce").mean()),
    ).reset_index()
    grouped.columns = ["name", "score", "count", "avg_price"]
    grouped["score"] = grouped["score"].round(2)

    total_count = int(len(df))

    # 推荐首选：score * log(count) 加权，避免小样本占优
    threshold = max(2, total_count // 20)  # 至少 2 条或总样本的 5%
    valid_best = grouped[grouped["count"] >= threshold].copy()
    if valid_best.empty:
        valid_best = grouped.copy()
    valid_best["weighted"] = valid_best["score"] * valid_best["count"].apply(lambda x: math.log(x + 1))
    best = valid_best.sort_values("weighted", ascending=False).iloc[0]

    # 人气王：评价数最多
    hot = grouped.sort_values("count", ascending=False).iloc[0]

    # 性价比之选：评分前 50% 窗口中，按 avg_score / avg_price 排序（价格最低优先）
    has_price = grouped.dropna(subset=["avg_price"])
    has_price = has_price[has_price["avg_price"] > 0]
    if not has_price.empty:
        score_median = has_price["score"].median()
        high_score = has_price[has_price["score"] >= score_median].copy()
        if not high_score.empty:
            high_score = high_score.sort_values("avg_price", ascending=True)
            value = high_score.iloc[0]
        else:
            value = has_price.sort_values("avg_price", ascending=True).iloc[0]
    else:
        # 没价格数据，就按评分来
        value = grouped.sort_values("score", ascending=False).iloc[0]

    # 避雷预警：样本量足够前提下分最低
    valid_worst = grouped[grouped["count"] >= threshold]
    if valid_worst.empty:
        valid_worst = grouped
    warn = valid_worst.sort_values("score", ascending=True).iloc[0]

    # reason 文案
    best_reason = f"评分 {best['score']}，{int(best['count'])} 人评价"

    return {
        "best_window": {
            "name": best["name"],
            "score": best["score"],
            "reason": best_reason,
        },
        "hot_window": {
            "name": hot["name"],
            "count": int(hot["count"]),
        },
        "value_window": {
            "name": value["name"],
            "score": value["score"],
            "avg_price": f"¥{round(value['avg_price'], 1)}" if pd.notna(value.get("avg_price")) and value.get("avg_price", 0) > 0 else "-",
        },
        "warn_window": {
            "name": warn["name"],
            "score": warn["score"],
            "count": int(warn["count"]),
        },
        "total_count": total_count,
    }


# ======================== 学生端推荐 API ========================

# 维度 → 关键词映射（用于从 tags 提取维度评分）
_DIM_POS = {
    "口味": ["好吃", "口味正宗", "够味", "味道好"],
    "分量": ["分量足", "量够", "量大"],
    "性价比": ["价格实惠", "实惠", "划算", "物超所值"],
    "卫生": ["干净卫生", "食材新鲜", "新鲜"],
    "速度": ["出餐快", "出餐迅速", "上菜快"],
    "服务": ["服务好", "态度好"],
}
_DIM_NEG = {
    "口味": ["味道一般", "太辣了", "偏咸", "不够入味"],
    "分量": ["量太少", "量少", "分量少"],
    "性价比": ["价格偏贵", "偏贵", "性价比低"],
    "卫生": ["卫生一般"],
    "速度": ["排队太久", "排队", "等待时间长"],
    "服务": [],
}


def _parse_tags(tag_str) -> list:
    """把 tags 字符串解析成 list，兼容 json 和原始字符串"""
    if not tag_str:
        return []
    if isinstance(tag_str, list):
        return tag_str
    try:
        lst = json.loads(tag_str)
        if isinstance(lst, list):
            return [str(t) for t in lst]
    except (json.JSONDecodeError, TypeError):
        pass
    # fallback：用逗号/顿号分割
    text = str(tag_str)
    for sep in ["、", ",", "|", " "]:
        if sep in text:
            return [t.strip() for t in text.split(sep) if t.strip()]
    return [text]


def _extract_dim_scores(df: pd.DataFrame) -> dict:
    """从整表 tags 中计算各维度分数（1-5），返回 {dim_name: score}"""
    if df.empty or "tags" not in df.columns:
        return {}

    # 统计每个维度的正面/负面提及数
    pos_count = {k: 0 for k in _DIM_POS}
    neg_count = {k: 0 for k in _DIM_NEG}

    for _, row in df.iterrows():
        tags = _parse_tags(row.get("tags", ""))
        tags_text = " ".join(tags)  # 用于子串匹配
        # 也把评价文字加进来
        comment = str(row.get("评价文字", ""))
        combined = tags_text + " " + comment

        for dim, keywords in _DIM_POS.items():
            for kw in keywords:
                if kw in combined:
                    pos_count[dim] += 1
                    break
        for dim, keywords in _DIM_NEG.items():
            for kw in keywords:
                if kw in combined:
                    neg_count[dim] += 1
                    break

    total_rows = len(df)
    dim_scores = {}
    for dim in _DIM_POS.keys():
        p = pos_count[dim]
        n = neg_count[dim]
        # 基础分 3.0，正加负减
        mentions = p + n
        if mentions == 0:
            continue  # 没人提这个维度，跳过不显示
        score = 3.0 + (p / max(mentions, 1)) * 2 - (n / max(mentions, 1)) * 2
        # 用数据量权重：提及率越高，分越可信
        mention_rate = mentions / total_rows
        score = 3.0 + (score - 3.0) * min(1.0, mention_rate * 1.5)
        dim_scores[dim] = round(max(1.0, min(5.0, score)), 2)

    return dim_scores


def compute_recommend_random(df: pd.DataFrame) -> dict:
    """
    随机推荐一个"今天吃什么"的结果
    策略：排除最低分的窗口，从剩余有评分的菜品里随机选
    返回一个菜品信息 dict
    """
    if df.empty:
        return {"ok": False, "msg": "暂无数据"}

    # 先按窗口聚合，过滤掉窗口平均分 < 3 的（避免推荐垃圾窗口）
    window_avg = df.groupby("窗口名")["评分"].mean()
    good_windows = window_avg[window_avg >= 3.0].index.tolist()
    if not good_windows:
        good_windows = window_avg.index.tolist()

    # 过滤出好窗口的菜品行（且评分 >= 3）
    candidates = df[(df["窗口名"].isin(good_windows)) & (df["评分"] >= 3.0)].copy()
    if candidates.empty:
        candidates = df.copy()

    # 随机选一个
    row = candidates.sample(1, random_state=None).iloc[0]

    window_name = row["窗口名"]
    window_info = next((w for w in WINDOWS if w["name"] == window_name), None)
    canteen = window_info["canteen"] if window_info else ""
    window_image = window_info["image"] if window_info else ""

    # 生成推荐理由（从 tags 里摘正面的）
    tags = _parse_tags(row.get("tags", ""))
    pos_tags = [t for t in tags if any(kw in t for kw in ["好吃", "分量", "实惠", "新鲜", "快", "正宗", "干净", "香", "够味"])]
    reason = pos_tags[0] if pos_tags else ""

    # 如果没有正面 tag，就从评价文字里摘一句
    if not reason and row.get("评价文字"):
        comment = str(row["评价文字"])[:30]
        reason = comment

    # 计算推荐百分比
    window_rows = df[df["窗口名"] == window_name]
    recommend_pct = int((window_rows["评分"] >= 4.0).mean() * 100) if len(window_rows) > 0 else 70

    price_val = row.get("价格", "")
    # 价格是数值时用 :g 去掉多余小数位（6.0 → 6），否则会显示成「¥6.0」
    if isinstance(price_val, (int, float)) and not pd.isna(price_val) and price_val > 0:
        price_str = f"¥{price_val:g}"
    else:
        price_str = ""

    return {
        "ok": True,
        "dish": row.get("菜品名", ""),
        "window": window_name,
        "canteen": canteen,
        "cuisine": row.get("菜系类型", ""),
        "score": row.get("评分", ""),
        "price": price_str,
        "reason": reason,
        "recommend_pct": recommend_pct,
        # 菜品自己的展示图（有同学上传过才有）。为空时前端回退到窗口照片
        "dish_image": load_dish_images().get((window_name, row.get("菜品名", "")), ""),
        "image": window_image,
    }


def compute_window_detail(df: pd.DataFrame, window_name: str) -> dict:
    """
    窗口口碑详情
    返回：维度评分、推荐菜品 Top3、同学反馈问题
    """
    if df.empty:
        return {"ok": False, "msg": "暂无数据"}

    window_df = df[df["窗口名"] == window_name]
    if window_df.empty:
        # 尝试模糊匹配
        for w_name in df["窗口名"].unique():
            if window_name in w_name or w_name in window_name:
                window_df = df[df["窗口名"] == w_name]
                window_name = w_name
                break
        if window_df.empty:
            return {"ok": False, "msg": f"找不到窗口：{window_name}"}

    # 窗口基本信息
    window_info = next((w for w in WINDOWS if w["name"] == window_name), None)
    canteen = window_info["canteen"] if window_info else ""
    window_image = window_info["image"] if window_info else ""

    overall_score = round(window_df["评分"].mean(), 2)
    count = len(window_df)

    # 维度评分
    dim_scores = _extract_dim_scores(window_df)

    # 推荐菜品 Top3（按平均分排序，需要有价格）
    dishes = window_df[window_df["价格"] != ""].copy()
    if dishes.empty:
        dishes = window_df.copy()
    dish_stats = dishes.groupby("菜品名").agg(
        score=("评分", "mean"),
        count=("评分", "size"),
        avg_price=("价格", lambda x: pd.to_numeric(x, errors="coerce").mean()),
    ).round(2).sort_values("score", ascending=False).head(3).reset_index()

    top_dishes = []
    for _, d in dish_stats.iterrows():
        price_str = f"¥{int(d['avg_price'])}" if pd.notna(d.get("avg_price")) and d["avg_price"] > 0 else ""
        top_dishes.append({
            "name": d["菜品名"],
            "score": d["score"],
            "price": price_str,
            "count": int(d["count"]),
        })

    # 同学反馈问题（负面标签频率 Top 3）
    all_tags = []
    for tag_str in window_df.get("tags", pd.Series([], dtype=str)):
        all_tags.extend(_parse_tags(tag_str))
    from collections import Counter
    tag_counts = Counter(all_tags)

    # 只保留负面相关
    neg_keywords = ["一般", "油", "少", "贵", "太辣", "太咸", "排队", "等", "凉", "卫生"]
    neg_tags = [t for t, c in tag_counts.most_common(20) if any(kw in t for kw in neg_keywords)]

    # 也从评价文字里挖
    neg_text_keywords = ["排队", "太久", "太油", "量少", "偏贵", "太辣", "偏咸", "凉", "一般", "等了"]
    text_neg = []
    for comment in window_df["评价文字"].dropna():
        for kw in neg_text_keywords:
            if kw in str(comment) and kw not in text_neg:
                text_neg.append(kw)
                break

    problems = neg_tags[:3] or text_neg[:3]
    if not problems:
        problems = ["暂无明显差评反馈"]

    # 所有评价明细（按日期倒序，最新的在上面）
    reviews_df = window_df.sort_values("日期", ascending=False)
    all_reviews = []
    for _, row in reviews_df.iterrows():
        price_val = row.get("价格", "")
        price_str = f"¥{price_val}" if price_val and str(price_val) != "" else "-"
        all_reviews.append({
            "dish": row.get("菜品名", ""),
            "score": row.get("评分", 0),
            "price": price_str,
            "comment": row.get("评价文字", "") or "",
            "date": row.get("日期", ""),
        })

    return {
        "ok": True,
        "window": window_name,
        "canteen": canteen,
        "image": window_image,
        "overall_score": overall_score,
        "total_count": count,
        "dim_scores": dim_scores,
        "top_dishes": top_dishes,
        "problems": problems,
        "all_reviews": all_reviews,
    }


def compute_search_advanced(
    df: pd.DataFrame,
    min_price: float = None,
    max_price: float = None,
    cuisine: str = "",
    preference: str = "",
) -> list:
    """
    条件筛选推荐
    preference 可选值："" (综合) / "高评分" / "高性价比" / "分量足" / "出餐快"
    返回菜品列表 [{菜品, 窗口, 价格, 评分, 理由}]
    """
    if df.empty:
        return []

    result = df.copy()

    # 价格筛选
    result["价格_num"] = pd.to_numeric(result["价格"], errors="coerce")
    if min_price is not None:
        result = result[result["价格_num"] >= min_price]
    if max_price is not None:
        result = result[(result["价格_num"] <= max_price) | result["价格_num"].isna()]

    # 菜系筛选
    if cuisine and cuisine != "全部":
        result = result[result["菜系类型"] == cuisine]

    if result.empty:
        return []

    # 偏好排序权重
    def _pref_score(row):
        base = row["评分"]
        tags_text = " ".join(_parse_tags(row.get("tags", "")))
        comment = str(row.get("评价文字", ""))
        combined = tags_text + " " + comment
        price = row["价格_num"] if pd.notna(row["价格_num"]) and row["价格_num"] > 0 else 15

        bonus = 0
        if preference == "高性价比":
            # 同评分下便宜的优先
            bonus = (5 - price / 10) * 0.5
        elif preference == "分量足":
            if any(kw in combined for kw in ["分量足", "量大", "量够"]):
                bonus = 0.5
        elif preference == "出餐快":
            if any(kw in combined for kw in ["出餐快", "上菜快", "出餐迅速"]):
                bonus = 0.5
        # 默认高评分不需要额外 bonus
        return base + bonus

    result["pref_score"] = result.apply(_pref_score, axis=1)

    # 聚合到菜品级别（同一窗口同菜品取平均分）
    dish_group = result.groupby(["窗口名", "菜品名"]).agg(
        score=("评分", "mean"),
        count=("评分", "size"),
        pref_score=("pref_score", "mean"),
        cuisine=("菜系类型", "first"),
        avg_price=("价格_num", "mean"),
    ).round({"score": 2, "pref_score": 2}).reset_index()

    dish_group = dish_group.sort_values("pref_score", ascending=False).head(20)

    output = []
    for _, row in dish_group.iterrows():
        price_str = f"¥{int(row['avg_price'])}" if pd.notna(row.get("avg_price")) and row["avg_price"] > 0 else "-"
        output.append({
            "window": row["窗口名"],
            "dish": row["菜品名"],
            "cuisine": row["cuisine"],
            "score": row["score"],
            "price": price_str,
            "count": int(row["count"]),
        })

    return output


def compute_popularity_ranking(df: pd.DataFrame, top_n: int = 15) -> list:
    """
    餐品人气榜：按投票数（是否投票=True）排名 Top N
    聚合键：(窗口名 + 菜品名)，因为不同食堂可能有同名菜品
    返回 [{dish, window, cuisine, votes, avg_score}, ...]
    """
    if df.empty or "是否投票" not in df.columns:
        return []

    # 只看有投票的菜品行（排除 "窗口综合"）
    voted = df[(df["是否投票"] == True) & (df["菜品名"] != "窗口综合")].copy()
    if voted.empty:
        return []

    # 按 (窗口名, 菜品名) 聚合：票数 + 平均分 + 菜系
    grouped = voted.groupby(["窗口名", "菜品名"]).agg(
        votes=("是否投票", "sum"),
        avg_score=("评分", "mean"),
        cuisine=("菜系类型", "first"),
    ).reset_index()

    grouped = grouped.sort_values("votes", ascending=False).head(top_n)

    result = []
    # 一次读全，避免在循环里反复查库
    dish_images = load_dish_images()
    for rank, (_, row) in enumerate(grouped.iterrows(), start=1):
        result.append({
            "rank": rank,
            "dish": row["菜品名"],
            "window": row["窗口名"],
            "cuisine": row["cuisine"],
            "votes": int(row["votes"]),
            "avg_score": round(row["avg_score"], 2),
            # 菜品展示图优先于窗口照片
            "dish_image": dish_images.get((row["窗口名"], row["菜品名"]), ""),
            "image": WINDOW_INFO_MAP.get(row["窗口名"], {}).get("image", ""),
        })

    return result


def compute_window_list(df: pd.DataFrame) -> list:
    """
    窗口口碑页用：每个窗口一行

    返回 [{name, canteen, cuisine, image, score, count}, ...]，按平均分降序
    食堂筛选标签由前端从 canteen 字段去重得到，不用后端再算一遍
    """
    if df.empty or "评分" not in df.columns:
        return []

    # 只统计有真实评分的行：
    # 自定义餐品本身没有评分（评分为 NaN），不能算进窗口均分
    scored = df[df["评分"].notna()]
    if scored.empty:
        return []

    grouped = scored.groupby("窗口名")["评分"].agg(["mean", "size"]).reset_index()
    grouped.columns = ["name", "score", "count"]

    result = []
    for _, row in grouped.iterrows():
        name = row["name"]
        info = WINDOW_INFO_MAP.get(name, {})
        result.append({
            "name": name,
            "canteen": info.get("canteen", "其他"),
            "cuisine": info.get("cuisine", ""),
            "image": info.get("image", ""),
            "score": round(float(row["score"]), 2),
            "count": int(row["count"]),
        })

    # 分数高的在前；同分则评价多的在前
    result.sort(key=lambda x: (-x["score"], -x["count"]))
    return result
