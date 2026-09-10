# -*- coding: utf-8 -*-
"""
食堂窗口菜品评价看板 - Flask 后端
提供数据 API、页面渲染 和 问卷接口
"""

import io
import sqlite3
import time
import uuid
from datetime import datetime

import pandas as pd
from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    send_file,
    session,
)

# 导入我们自己写的模块
from utils.data_loader import (
    apply_filters,
    compute_cuisine_score,
    compute_data_date,
    compute_price_scatter,
    compute_score_dist,
    compute_stats,
    compute_table_data,
    compute_window_avg,
    compute_window_rank,
    ensure_survey_db,
    enrich_windows_with_dishes,
    load_data,
    load_survey_data,
    save_survey_responses,
)
from utils.text_analyzer import compute_word_freq
from config.windows import WINDOWS, POSITIVE_TAGS, NEGATIVE_TAGS, DISH_TAGS_POSITIVE, DISH_TAGS_NEGATIVE

app = Flask(__name__)
app.secret_key = "canteen-dashboard-secret"  # session 需要

# ============================================================
# 全局状态管理：当前活跃数据
# - source: "mock" 模拟数据 / "upload" 上传文件 / "survey" 问卷收集数据
# - _uploaded_df: 上传文件的数据（仅当 source=="upload" 时使用）
# ============================================================

_source = "survey"
_uploaded_df = None
_data_source_label = "问卷收集数据"


def get_df():
    """根据当前数据源返回正确的 DataFrame"""
    global _source, _uploaded_df
    if _source == "survey":
        return load_survey_data()
    elif _source == "upload":
        if _uploaded_df is not None:
            return _uploaded_df
        return load_data(None)  # 兜底
    else:  # mock
        return load_data(None)


@app.route("/")
def index():
    """渲染主页面"""
    global _data_source_label

    df = get_df()
    cuisines = ["全部"] + sorted(df["菜系类型"].unique().tolist())

    return render_template(
        "index.html",
        data_source=_data_source_label,
        data_date=compute_data_date(df),
        total_count=len(df),
        cuisines=cuisines,
        current_source=_source,
    )


@app.route("/survey")
def survey():
    """渲染问卷页面"""
    return render_template("survey.html")


# ============================================================
# 数据源切换 API
# ============================================================

@app.route("/api/source", methods=["POST"])
def api_switch_source():
    """切换数据源：mock / upload / survey"""
    global _source, _uploaded_df, _data_source_label

    data = request.get_json(silent=True) or {}
    target = data.get("source", "mock")

    if target == "mock":
        _source = "mock"
        _uploaded_df = None
        _data_source_label = "模拟数据"
    elif target == "survey":
        _source = "survey"
        _data_source_label = "问卷收集数据"
    elif target == "upload":
        if _uploaded_df is None:
            return jsonify({"ok": False, "msg": "还没有上传文件"}), 400
        _source = "upload"
        _data_source_label = f"上传文件: (已上传)"
    else:
        return jsonify({"ok": False, "msg": f"未知数据源: {target}"}), 400

    df = get_df()
    return jsonify({
        "ok": True,
        "source": _source,
        "data_source": _data_source_label,
        "total": len(df),
        "data_date": compute_data_date(df),
    })


# ============================================================
# 看板数据 API
# ============================================================

@app.route("/api/stats")
def api_stats():
    """统计卡片数据"""
    global _data_source_label
    df = get_df()
    search = request.args.get("search", "").strip()
    cuisine = request.args.get("cuisine", "").strip()

    filtered = apply_filters(df, search, cuisine)
    stats = compute_stats(filtered)
    stats["data_source"] = _data_source_label
    stats["data_date"] = compute_data_date(df)
    return jsonify(stats)


@app.route("/api/charts")
def api_charts():
    """所有图表数据（一次请求返回全部 6 张图）"""
    df = get_df()
    search = request.args.get("search", "").strip()
    cuisine = request.args.get("cuisine", "").strip()

    filtered = apply_filters(df, search, cuisine)

    result = {
        "window_avg": compute_window_avg(filtered),
        "score_dist": compute_score_dist(filtered),
        "window_rank": compute_window_rank(filtered),
        "cuisine_score": compute_cuisine_score(filtered),
        "price_scatter": compute_price_scatter(filtered),
        "word_cloud": compute_word_freq(filtered),
    }
    return jsonify(result)


@app.route("/api/table")
def api_table():
    """原始数据表格（分页）"""
    df = get_df()
    search = request.args.get("search", "").strip()
    cuisine = request.args.get("cuisine", "").strip()
    page = int(request.args.get("page", 1))
    size = int(request.args.get("size", 20))

    filtered = apply_filters(df, search, cuisine)
    result = compute_table_data(filtered, page, size)
    return jsonify(result)


@app.route("/api/cuisines")
def api_cuisines():
    """获取所有菜系类型（侧边栏快捷筛选用）"""
    df = get_df()
    cuisines = sorted(df["菜系类型"].unique().tolist())
    return jsonify(["全部"] + cuisines)


# ============================================================
# 文件上传 / 下载
# ============================================================

@app.route("/api/upload", methods=["POST"])
def api_upload():
    """上传 Excel/CSV 文件，同时切换数据源"""
    global _source, _uploaded_df, _data_source_label

    if "file" not in request.files:
        return jsonify({"ok": False, "msg": "没有收到文件"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"ok": False, "msg": "文件名为空"}), 400

    if not (file.filename.endswith(".csv") or file.filename.endswith(".xlsx") or file.filename.endswith(".xls")):
        return jsonify({"ok": False, "msg": "只支持 CSV 或 Excel 文件"}), 400

    try:
        df = load_data(file)
        _uploaded_df = df
        _source = "upload"
        _data_source_label = f"上传文件: {file.filename}"
        return jsonify({
            "ok": True,
            "msg": f"成功加载 {len(df)} 条数据",
            "total": len(df),
            "data_date": compute_data_date(df),
            "data_source": _data_source_label,
            "source": _source,
        })
    except Exception as e:
        return jsonify({"ok": False, "msg": f"文件解析失败: {str(e)}"}), 500


@app.route("/api/reset")
def api_reset():
    """重置回模拟数据"""
    global _source, _uploaded_df, _data_source_label
    _source = "mock"
    _uploaded_df = None
    _data_source_label = "模拟数据"
    return jsonify({"ok": True, "total": len(get_df())})


@app.route("/api/download")
def api_download():
    """下载当前筛选后的数据为 CSV"""
    df = get_df()
    search = request.args.get("search", "").strip()
    cuisine = request.args.get("cuisine", "").strip()

    filtered = apply_filters(df, search, cuisine)

    buf = io.BytesIO()
    filtered.to_csv(buf, index=False, encoding="utf-8-sig")
    buf.seek(0)

    filename = f"食堂评价数据_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return send_file(
        buf,
        mimetype="text/csv",
        as_attachment=True,
        download_name=filename,
    )


# ============================================================
# 问卷 API
# ============================================================

@app.route("/api/survey/windows")
def api_survey_windows():
    """返回窗口配置（含 dishes）+ 预设标签"""
    # enrich_windows_with_dishes 会读取 CSV 并给匹配的窗口加上 dishes 数组
    enriched = enrich_windows_with_dishes(list(WINDOWS))
    return jsonify({
        "windows": enriched,
        "positive_tags": POSITIVE_TAGS,
        "negative_tags": NEGATIVE_TAGS,
        "dish_tags_positive": DISH_TAGS_POSITIVE,
        "dish_tags_negative": DISH_TAGS_NEGATIVE,
    })


@app.route("/api/survey/submit", methods=["POST"])
def api_survey_submit():
    """接收问卷提交，存入 SQLite"""
    global _source, _data_source_label

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"ok": False, "msg": "无效请求"}), 400

    responses = data.get("responses", [])
    if not responses:
        return jsonify({"ok": False, "msg": "没有有效的评价数据"}), 400

    # 验证每条记录
    for r in responses:
        if not r.get("window_name"):
            return jsonify({"ok": False, "msg": "缺少窗口名"}), 400
        score = r.get("satisfaction", 0)
        if not (1 <= int(score) <= 5):
            return jsonify({"ok": False, "msg": "评分必须在 1-5 之间"}), 400

    # 获取或生成匿名用户标识
    submitter_id = session.get("submitter_id")
    if not submitter_id:
        submitter_id = uuid.uuid4().hex[:12]
        session["submitter_id"] = submitter_id

    try:
        saved = save_survey_responses(responses, submitter_id)

        # 自动切到问卷数据源
        _source = "survey"
        _data_source_label = "问卷收集数据"

        df = load_survey_data()
        return jsonify({
            "ok": True,
            "msg": f"感谢！已保存 {saved} 条评价",
            "saved": saved,
            "total_survey": len(df),
        })
    except Exception as e:
        return jsonify({"ok": False, "msg": f"保存失败: {str(e)}"}), 500


@app.route("/api/survey/records")
def api_survey_records():
    """查询已提交的问卷记录数量"""
    df = load_survey_data()
    return jsonify({
        "total": len(df),
        "windows": df["窗口名"].value_counts().to_dict() if not df.empty else {},
    })


# ============================================================
# 启动入口
# ============================================================

if __name__ == "__main__":
    # 提前确保 SQLite 数据库存在
    ensure_survey_db()

    print("=" * 60)
    print("🍱 食堂窗口菜品评价看板")
    print(f"📊 默认数据源: {_data_source_label}")
    print(f"🚀 看板:  http://127.0.0.1:8000")
    print(f"📝 问卷:  http://127.0.0.1:8000/survey")
    print("=" * 60)

    app.run(host="0.0.0.0", port=8000, debug=False)
