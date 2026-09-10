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
import sqlite3
import pandas as pd
from datetime import datetime

from utils.mock_data import generate_canteen_data
from config.windows import WINDOW_CUISINE_MAP


# 项目根目录
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# SQLite 数据库路径（项目根目录下 data/ 文件夹）
_DB_PATH = os.path.join(_PROJECT_ROOT, "data", "survey.db")

# 菜品配置 CSV 路径
_DISHES_CSV_PATH = os.path.join(
    _PROJECT_ROOT, "static", "form", "食堂窗口菜单价格表.csv"
)


# ======================== 菜品数据加载 ========================

def load_dishes_from_csv(csv_path: str) -> dict:
    """
    读取 CSV，返回 {窗口简称: [{"name": 菜品名, "price": float}, ...]}

    处理：ffill 窗口名 / 地点、价格去掉"元"转 float
    编码：先试 utf-8-sig，失败再试 gbk
    读取异常时返回空 dict（不会 crash）
    """
    try:
        # 尝试两种常见编码
        try:
            df = pd.read_csv(csv_path, encoding="utf-8-sig")
        except UnicodeDecodeError:
            df = pd.read_csv(csv_path, encoding="gbk")

        # ffill 窗口名和地点（CSV 里窗口名只在第一行写一次，后续行是 NaN）
        df["窗口名"] = df["窗口名"].ffill()

        dishes_by_window = {}
        for _, row in df.iterrows():
            window_short = str(row["窗口名"]).strip()
            dish_name = str(row["餐品"]).strip()
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
        print(f"[WARN] 读取菜品 CSV 失败: {e}，窗口将保持无菜品选择器")
        return {}


def enrich_windows_with_dishes(windows: list, dishes_csv_path: str = None) -> list:
    """
    把 CSV 里的菜品合并到窗口列表里。
    通过 "CSV简称 in config全称" 做包含匹配。
    匹配不上的窗口不加 dishes 字段（保持老样子）。

    这是纯函数：返回新的 list，不修改原对象（但里面的 dict 会被加 dishes key）
    """
    if dishes_csv_path is None:
        dishes_csv_path = _DISHES_CSV_PATH

    dishes_by_short = load_dishes_from_csv(dishes_csv_path)
    if not dishes_by_short:
        return list(windows)  # 没数据就原样返回

    # 给每个匹配上的 window 加 dishes
    for window in windows:
        window_name = window["name"]
        for short_name, dishes in dishes_by_short.items():
            if short_name in window_name:
                window["dishes"] = dishes
                break  # 匹配上就停，避免多个简称都包含的情况（实际上不会有）

    return list(windows)


def ensure_survey_db():
    """确保 SQLite 数据库和表存在，自动迁移 dish_evaluations 列"""
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

    conn.commit()
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


def load_survey_data() -> pd.DataFrame:
    """
    从 SQLite 读取问卷数据，转换成看板需要的 DataFrame 格式

    核心逻辑变更：
        - dish_evaluations 有内容 → 每个菜品展开成独立行（菜品名、价格、description 都用上）
        - dish_evaluations 为空/NULL → fallback 成 1 行 "窗口综合"，价格空
        - 窗口级的评分、tags 共享给每个展开的菜品行
    """
    ensure_survey_db()
    conn = sqlite3.connect(_DB_PATH)
    try:
        df = pd.read_sql_query(
            "SELECT window_name, satisfaction, tags, comment, dish_evaluations, submit_date FROM survey_responses",
            conn,
        )
    finally:
        conn.close()

    if df.empty:
        return pd.DataFrame(
            columns=["窗口名", "菜品名", "菜系类型", "评分", "价格", "评价文字", "日期"]
        )

    records = []
    for _, row in df.iterrows():
        window_name = row["window_name"]
        score = float(row["satisfaction"])
        date_str = row["submit_date"][:10]  # YYYY-MM-DD
        cuisine = WINDOW_CUISINE_MAP.get(window_name, "")

        # tags JSON → list
        try:
            tag_list = json.loads(row["tags"]) if row["tags"] else []
        except (json.JSONDecodeError, TypeError):
            tag_list = []

        # dish_evaluations JSON → list
        try:
            dish_evals = json.loads(row["dish_evaluations"]) if row["dish_evaluations"] else []
        except (json.JSONDecodeError, TypeError):
            dish_evals = []

        # 基础评价文字：tags + 窗口级 comment
        base_parts = []
        if tag_list:
            base_parts.append("、".join(tag_list))
        if row["comment"]:
            base_parts.append(row["comment"])

        if dish_evals:
            # 有菜品评价 → 每个菜品展开一行
            for dish in dish_evals:
                dish_name = dish.get("name", "")
                try:
                    price = float(dish.get("price", 0))
                except (ValueError, TypeError):
                    price = 0.0
                dish_desc = dish.get("description", "")
                dish_tags = dish.get("tags", [])

                # 评价文字：基础部分 + 菜品级标签 + 菜品描述
                text_parts = list(base_parts)  # copy
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
                })
        else:
            # 无菜品评价 → fallback：窗口综合
            records.append({
                "窗口名": window_name,
                "菜品名": "窗口综合",
                "菜系类型": cuisine,
                "评分": score,
                "价格": "",
                "评价文字": " | ".join(base_parts) if base_parts else "",
                "日期": date_str,
            })

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
