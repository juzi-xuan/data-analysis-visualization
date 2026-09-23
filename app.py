# -*- coding: utf-8 -*-
"""
食堂窗口菜品评价看板 - Flask 后端
提供数据 API、页面渲染 和 问卷接口
"""

import io
import os
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
    compute_analysis_stats,
    compute_canteen_compare,
    compute_cuisine_score,
    compute_data_date,
    compute_popularity_ranking,
    compute_price_scatter,
    compute_recommend_random,
    compute_score_dist,
    compute_search_advanced,
    compute_sentiment,
    compute_stats,
    compute_student_summary,
    compute_table_data,
    compute_trend,
    compute_window_avg,
    compute_window_detail,
    compute_window_list,
    compute_window_rank,
    ensure_survey_db,
    enrich_windows_with_dishes,
    load_custom_dishes,
    load_data,
    load_dish_images,
    load_survey_data,
    save_dish_image,
    save_survey_responses,
)
from utils.text_analyzer import compute_word_freq
from utils.persona import compute_persona
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
    """渲染学生端首页"""
    return render_template(
        "index.html",
        nav_active="home",
        search_placeholder="搜索食堂、窗口、菜品…",
        search_label="搜索菜品或窗口",
    )


@app.route("/survey")
def survey():
    """渲染问卷页面"""
    return render_template(
        "survey.html",
        nav_active="survey",
        search_placeholder="搜索窗口、食堂、菜品…",
        search_label="搜索窗口",
    )


@app.route("/windows")
def windows_page():
    """渲染窗口口碑页面（学生端）"""
    return render_template(
        "windows.html",
        nav_active="windows",
        search_placeholder="搜索窗口、食堂、菜系…",
        search_label="搜索窗口",
    )


@app.route("/analysis")
def analysis():
    """渲染分析师看板页面（简历版，独立入口，无跳转按钮）"""
    global _data_source_label

    df = get_df()
    cuisines = ["全部"] + sorted(df["菜系类型"].unique().tolist())

    return render_template(
        "analysis.html",
        data_source=_data_source_label,
        data_date=compute_data_date(df),
        total_count=len(df),
        cuisines=cuisines,
        current_source=_source,
    )


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


@app.route("/api/student_summary")
def api_student_summary():
    """学生决策看板专用汇总（推荐/人气/性价比/避雷 4 张卡片）"""
    df = get_df()
    search = request.args.get("search", "").strip()
    cuisine = request.args.get("cuisine", "").strip()

    filtered = apply_filters(df, search, cuisine)
    return jsonify(compute_student_summary(filtered))


# ============================================================
# 学生端：三个推荐功能 API
# ============================================================

@app.route("/api/recommend/random")
def api_recommend_random():
    """🎲 随机推荐一个菜品（今天吃什么）"""
    df = get_df()
    return jsonify(compute_recommend_random(df))


@app.route("/api/recommend/window")
def api_recommend_window():
    """🔥 窗口口碑详情（维度评分 + 推荐菜品 + 同学反馈问题）"""
    df = get_df()
    window_name = request.args.get("window", "").strip()
    if not window_name:
        return jsonify({"ok": False, "msg": "缺少窗口名参数"}), 400
    return jsonify(compute_window_detail(df, window_name))


@app.route("/api/recommend/search")
def api_recommend_search():
    """🔍 条件筛选菜品（预算 + 类型 + 偏好）"""
    df = get_df()
    try:
        min_price = request.args.get("min_price")
        max_price = request.args.get("max_price")
        min_price = float(min_price) if min_price else None
        max_price = float(max_price) if max_price else None
    except ValueError:
        min_price = max_price = None

    cuisine = request.args.get("cuisine", "").strip()
    preference = request.args.get("preference", "").strip()

    result = compute_search_advanced(df, min_price, max_price, cuisine, preference)
    return jsonify({"ok": True, "count": len(result), "items": result})


@app.route("/api/popularity")
def api_popularity():
    """🏆 餐品人气榜（按投票数排名）"""
    df = get_df()
    top_n = request.args.get("top_n", 15, type=int)
    ranking = compute_popularity_ranking(df, top_n=top_n)
    total_votes = sum(item["votes"] for item in ranking)
    return jsonify({
        "ok": True,
        "items": ranking,
        "total_votes": int(df["是否投票"].sum()) if "是否投票" in df.columns else 0,
    })


@app.route("/api/windows")
def api_windows():
    """🏬 窗口口碑列表（每个窗口的平均分 + 评价数 + 食堂/菜系/图片）"""
    df = get_df()
    items = compute_window_list(df)
    return jsonify({
        "ok": True,
        "items": items,
        "canteens": ["全部"] + sorted({it["canteen"] for it in items}),
    })


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
    """返回窗口配置（含 dishes）+ 预设标签 + 自定义餐品"""
    # enrich_windows_with_dishes 会读取 CSV 并给匹配的窗口加上 dishes 数组
    enriched = enrich_windows_with_dishes(list(WINDOWS))

    # 给每道菜补上展示图（没有图就是空字符串，前端会回退成窗口照片）
    dish_images = load_dish_images()
    for w in enriched:
        for d in w.get("dishes", []):
            d["image"] = dish_images.get((w["name"], d["name"]), "")

    # 把自定义餐品也加入（作为"其他"食堂的窗口）
    custom_dishes = load_custom_dishes()
    custom_windows = []
    for cd in custom_dishes:
        custom_windows.append({
            "name": cd["store_name"],
            "canteen": "其他",
            "cuisine": cd["cuisine"],
            "image": cd["image_path"] or "",
            "description": cd["description"],
            "address": cd["address"],
            "dish_name": cd["dish_name"],
            # 自定义餐品本身就是一道菜，它的展示图就是上传的那张
            "dish_image": cd["image_path"] or "",
            "is_custom": True,
        })

    return jsonify({
        "windows": enriched + custom_windows,
        "custom_dishes": custom_dishes,
        "positive_tags": POSITIVE_TAGS,
        "negative_tags": NEGATIVE_TAGS,
        "dish_tags_positive": DISH_TAGS_POSITIVE,
        "dish_tags_negative": DISH_TAGS_NEGATIVE,
    })


# ============================================================
# 自定义餐品 API（用户添加自己喜欢的餐品）
# ============================================================

# 自定义餐品图片保存目录
_CUSTOM_IMAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "images", "custom")
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# 菜品展示图保存目录
_DISH_IMAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "images", "dishes")


@app.route("/api/survey/dish_image", methods=["POST"])
def api_survey_dish_image():
    """
    上传某道菜的展示图
    multipart/form-data：window_name / dish_name / image

    一道菜只允许一张图：已经有图就直接拒绝并返回现有图，
    避免多个同学重复上传把同一道菜的展示图改来改去。
    """
    os.makedirs(_DISH_IMAGE_DIR, exist_ok=True)

    window_name = (request.form.get("window_name") or "").strip()
    dish_name = (request.form.get("dish_name") or "").strip()
    if not window_name or not dish_name:
        return jsonify({"ok": False, "msg": "缺少窗口名或菜品名"}), 400

    image_file = request.files.get("image")
    if not image_file or not image_file.filename:
        return jsonify({"ok": False, "msg": "没有收到图片"}), 400

    ext = os.path.splitext(image_file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({"ok": False, "msg": "只支持 jpg / png / gif / webp 图片"}), 400

    filename = f"dish_{uuid.uuid4().hex[:12]}{ext}"
    save_path = os.path.join(_DISH_IMAGE_DIR, filename)
    image_file.save(save_path)

    submitter_id = session.get("submitter_id")
    if not submitter_id:
        submitter_id = uuid.uuid4().hex[:12]
        session["submitter_id"] = submitter_id

    image_path = f"/static/images/dishes/{filename}"
    if not save_dish_image(window_name, dish_name, image_path, submitter_id):
        # 已经有人传过了 → 把刚写入的文件删掉，不留孤儿文件
        try:
            os.remove(save_path)
        except OSError:
            pass
        return jsonify({
            "ok": False,
            "msg": "这道菜已经有同学上传过展示图啦",
            "image": load_dish_images().get((window_name, dish_name), ""),
        }), 409

    return jsonify({"ok": True, "msg": "展示图已保存", "image": image_path})


@app.route("/api/survey/custom_dish", methods=["POST"])
def api_survey_custom_dish():
    """
    添加自定义餐品（multipart/form-data，图片可选）
    同时如果填了满意度评分，会自动存一条初始评价到 survey_responses
    """
    global _source, _data_source_label

    # 确保图片目录存在
    os.makedirs(_CUSTOM_IMAGE_DIR, exist_ok=True)

    # 支持 JSON 和 form-data 两种提交方式
    if request.is_json:
        data = request.get_json(silent=True) or {}
    else:
        data = request.form.to_dict()

    store_name = (data.get("store_name") or "").strip()
    dish_name = (data.get("dish_name") or "").strip()

    if not store_name or not dish_name:
        return jsonify({"ok": False, "msg": "请填写店名和餐品名"}), 400

    address = (data.get("address") or "").strip()
    cuisine = (data.get("cuisine") or "其他").strip()
    description = (data.get("description") or "").strip()
    satisfaction = data.get("satisfaction")

    # 处理满意度
    try:
        satisfaction = int(satisfaction) if satisfaction else 0
        if satisfaction and not (1 <= satisfaction <= 5):
            satisfaction = 0
    except (ValueError, TypeError):
        satisfaction = 0

    # 处理图片（可选）
    image_path = ""
    if "image" in request.files:
        image_file = request.files["image"]
        if image_file and image_file.filename:
            ext = os.path.splitext(image_file.filename)[1].lower()
            if ext in ALLOWED_IMAGE_EXT:
                filename = f"custom_{uuid.uuid4().hex[:12]}{ext}"
                save_path = os.path.join(_CUSTOM_IMAGE_DIR, filename)
                image_file.save(save_path)
                image_path = f"/static/images/custom/{filename}"

    submitter_id = session.get("submitter_id")
    if not submitter_id:
        submitter_id = uuid.uuid4().hex[:12]
        session["submitter_id"] = submitter_id

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 存到 custom_dishes 表
    ensure_survey_db()
    conn = sqlite3.connect(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "survey.db")
    )
    try:
        # 检查是否已存在相同店名+餐品
        existing = conn.execute(
            "SELECT id FROM custom_dishes WHERE store_name = ? AND dish_name = ?",
            (store_name, dish_name),
        ).fetchone()
        if existing:
            conn.close()
            return jsonify({"ok": False, "msg": "这家店这个餐品已经有人添加过啦，可以直接去评价～"}), 400

        conn.execute(
            "INSERT INTO custom_dishes "
            "(store_name, address, dish_name, cuisine, image_path, description, submitter_id, submit_date) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (store_name, address, dish_name, cuisine, image_path, description, submitter_id, now),
        )
        conn.commit()
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    finally:
        conn.close()

    # 如果用户同时给了满意度评分，存到 survey_responses
    if satisfaction >= 1:
        tag_list = data.get("tags") or []
        if isinstance(tag_list, str):
            try:
                tag_list = json.loads(tag_list)
            except (json.JSONDecodeError, TypeError):
                tag_list = []

        comment = (data.get("comment") or "").strip()

        dish_name_for_eval = dish_name
        if data.get("voted"):
            dish_evals = [{
                "name": dish_name_for_eval,
                "price": 0,
                "description": description or comment,
                "tags": tag_list,
                "voted": True,
            }]
        else:
            dish_evals = []

        save_survey_responses([{
            "window_name": store_name,
            "satisfaction": satisfaction,
            "tags": tag_list,
            "comment": comment or description,
            "dish_evaluations": dish_evals,
        }], submitter_id)

        _source = "survey"
        _data_source_label = "问卷收集数据"

    return jsonify({
        "ok": True,
        "msg": f"🎉 成功添加「{store_name} - {dish_name}」！",
        "id": new_id,
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

        # 计算用户人设标签（返回 Top 3）
        window_map = {w["name"]: w for w in WINDOWS}
        personas = compute_persona(responses, window_map, top_n=3)

        df = load_survey_data()
        # 转换为前端友好的格式
        personas_out = [{
            "key": p["key"],
            "name": p["name"],
            "image": p["image"],
            "desc": p["desc"],
            "pct": p["pct"],
        } for p in personas]

        return jsonify({
            "ok": True,
            "msg": f"感谢！已保存 {saved} 条评价",
            "saved": saved,
            "total_survey": len(df),
            "personas": personas_out,
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
# 分析师看板专用 API
# ============================================================

@app.route("/api/analysis/stats")
def api_analysis_stats():
    """分析师视角统计量（含洞察摘要）"""
    df = get_df()
    return jsonify(compute_analysis_stats(df))


@app.route("/api/analysis/trend")
def api_analysis_trend():
    """评分时间趋势"""
    df = get_df()
    return jsonify(compute_trend(df))


@app.route("/api/analysis/canteen_compare")
def api_analysis_canteen_compare():
    """一食堂 vs 二食堂 对比"""
    df = get_df()
    return jsonify(compute_canteen_compare(df))


@app.route("/api/analysis/sentiment")
def api_analysis_sentiment():
    """正负情感标签占比"""
    df = get_df()
    return jsonify(compute_sentiment(df))


# ============================================================
# 图片缩略图 API（按需动态生成 + 磁盘缓存，节省带宽）
# ============================================================

from PIL import Image as PILImage

# 缩略图缓存目录（static/thumbs/ 下，按尺寸分子目录）
_THUMB_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "thumbs")
os.makedirs(_THUMB_ROOT, exist_ok=True)

# 允许的缩略图宽度（白名单防滥用）
_ALLOWED_THUMB_WIDTHS = {200, 300, 400, 600}


@app.route("/api/thumb")
def api_thumb():
    """
    图片缩略图服务：
      /api/thumb?path=/static/images/xxx.jpg&w=300

    工作流程：
    1. 把 path 转成真实文件路径，做安全校验（必须在 static/ 下）
    2. 缓存文件存在则直接返回，不存在才用 Pillow 生成
    3. 返回 JPEG 流 + 长缓存头（7 天）
    """
    import hashlib

    path = request.args.get("path", "").strip()
    width = request.args.get("w", 300, type=int)

    # 安全校验
    if not path.startswith("/static/"):
        return jsonify({"ok": False, "msg": "非法路径"}), 400
    if width not in _ALLOWED_THUMB_WIDTHS:
        width = 300

    # 真实源文件路径
    src_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), path.lstrip("/")
    )
    if not os.path.isfile(src_path):
        # 原图不存在，返回 404
        return ("not found", 404)

    # 缓存文件路径：按 width 分子目录 + 原路径 hash 做文件名
    safe_hash = hashlib.md5(path.encode("utf-8")).hexdigest()
    ext = os.path.splitext(src_path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    cache_file = os.path.join(_THUMB_ROOT, str(width), safe_hash + ext)

    # 缓存命中 → 直接返回（带上长缓存头）
    if os.path.isfile(cache_file):
        resp = send_file(cache_file, mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "public, max-age=604800"  # 7 天
        return resp

    # 未命中 → 用 Pillow 生成
    try:
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        with PILImage.open(src_path) as im:
            # 转 RGB（JPEG 不支持 RGBA）
            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            w, h = im.size
            # 按比例缩放
            if w > width:
                ratio = width / w
                new_h = int(h * ratio)
                im = im.resize((width, new_h), PILImage.LANCZOS)
            # 保存到缓存（JPEG quality=75，肉眼无差）
            im.save(cache_file, "JPEG", quality=75, optimize=True)
    except Exception as e:
        # 生成失败 → 返回原图兜底
        return send_file(src_path)

    resp = send_file(cache_file, mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "public, max-age=604800"
    return resp


# ============================================================
# 启动入口
# ============================================================

if __name__ == "__main__":
    # 提前确保 SQLite 数据库存在
    ensure_survey_db()

    print("=" * 60)
    print("🍱 食堂窗口菜品评价看板")
    print(f"📊 默认数据源: {_data_source_label}")
    print(f"👥 学生决策看板:  http://127.0.0.1:8000")
    print(f"📝 问卷:          http://127.0.0.1:8000/survey")
    print(f"🔬 分析看板(简历): http://127.0.0.1:8000/analysis")
    print("=" * 60)

    app.run(host="0.0.0.0", port=8000, debug=False)
