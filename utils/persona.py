# -*- coding: utf-8 -*-
"""
人设标签匹配引擎
根据用户问卷数据，匹配出专属的食堂人设标签（共 10 种）

匹配原则：
  - 基于菜系 + 窗口名关键词 + 用户选的标签 + 评论内容 + 行为特征 综合评分
  - 对立人设互相减分（辣味vs清淡、毒舌vs沉默、踩雷vs好评）
  - 评论关键词权重 > 标签权重 > 菜系权重
  - 行为特征：满意度方差、正负标签比例、评论长度、评论覆盖率
"""

import re
import statistics

# ========== 人设定义 ==========
PERSONAS = {
    # ---- 口味类（6 个） ----
    "tangshui_xintu": {
        "name": "汤水信徒",
        "image": "/static/label_images/汤水信徒.png",
        "desc": "汤是灵魂，面是信仰\n没有汤水的一餐不值得吃",
        "score": 0,
    },
    "qingdan_yinshi": {
        "name": "清淡隐士",
        "image": "/static/label_images/清淡隐士.png",
        "desc": "不追求刺激，只追求本味\n你的胃是一片清净的山林",
        "score": 0,
    },
    "tanshui_xianren": {
        "name": "碳水仙人",
        "image": "/static/label_images/碳水仙人.png",
        "desc": "面、粉、饼是你的三位一体\n卡路里？那是凡人的烦恼",
        "score": 0,
    },
    "chuangkou_haiwang": {
        "name": "窗口海王",
        "image": "/static/label_images/窗口海王.png",
        "desc": "七家窗口全都爱过\n你是食堂当之无愧的MVP",
        "score": 0,
    },
    "roushi_baojun": {
        "name": "肉食暴君",
        "image": "/static/label_images/肉食暴君.png",
        "desc": "没有肉的菜叫素\n你的胃是一座肉山",
        "score": 0,
    },
    "lawei_dutu": {
        "name": "辣味赌徒",
        "image": "/static/label_images/辣味赌徒.png",
        "desc": "辣是信仰，痛是快感\n微辣？那不是辣",
        "score": 0,
    },
    # ---- 行为类（4 个，新增） ----
    "cailei_xianfeng": {
        "name": "踩雷先锋",
        "image": "/static/label_images/踩雷先锋.png",
        "desc": "别人种草你踩雷\n食堂反向指北针就是你",
        "score": 0,
    },
    "dushe_meishijia": {
        "name": "毒舌美食家",
        "image": "/static/label_images/毒舌美食家.png",
        "desc": "没有一口是完美的\n你的评论比米其林还毒",
        "score": 0,
    },
    "chenmo_ganfanren": {
        "name": "沉默干饭人",
        "image": "/static/label_images/沉默干饭人.png",
        "desc": "吃就完事了\n话多影响干饭速度",
        "score": 0,
    },
    "duanshui_dashi": {
        "name": "端水大师",
        "image": "/static/label_images/端水大师.png",
        "desc": "好吃的真好吃\n不好吃的也真不好吃\n但我都给了好评（其实没有）",
        "score": 0,
    },
}

# ========== 菜系 & 关键词配置 ==========
SOUP_NOODLE_CUISINES = {"面食", "湖南菜", "江西菜"}
LIGHT_CUISINES = {"家常菜"}
SPICY_CUISINES = {"川菜", "湘菜", "湖南菜", "江西菜"}
MEAT_KEYWORDS = ["牛肉", "肉", "鸡", "排骨", "鱼", "虾"]
NOODLE_KEYWORDS = ["面", "粉", "饼"]

# 负面标签的干净词（emoji 去掉后），用于识别踩雷
NEGATIVE_TAG_CLEAN_WORDS = {
    "需要改进", "味道一般", "油太重", "量太少", "价格偏贵",
    "太辣了", "食物偏凉", "卫生一般", "太油", "量少", "偏贵", "太咸", "偏凉",
}
# 正面标签的干净词
POSITIVE_TAG_CLEAN_WORDS = {
    "好吃", "干净卫生", "服务好", "分量足", "价格实惠",
    "口味正宗", "食材新鲜", "出餐快", "够味", "热乎",
}

# ========== 标签关键词（PERSONA_TAG_KEYWORDS） ==========
# 用于用户选的标签（tag），权重 4
PERSONA_TAG_KEYWORDS = {
    "lawei_dutu": ["辣", "够味"],
    "qingdan_yinshi": ["清淡", "少油", "爽口", "不辣"],
    "roushi_baojun": [],
    "tanshui_xianren": ["分量", "量足"],
    "tangshui_xintu": ["汤", "热乎"],
}

# ========== 评论关键词（COMMENT_KEYWORDS） ==========
# 用于用户写的评论，权重 6（主动表达更强烈）
COMMENT_KEYWORDS = {
    "lawei_dutu": [
        "辣", "辣味", "香辣", "麻辣", "酸辣", "辛辣", "辣度",
        "无辣不欢", "能吃辣", "爱吃辣", "嗜辣", "辣爽",
        "够劲", "过瘾", "带劲", "重口", "下饭",
    ],
    "qingdan_yinshi": [
        "清淡", "养生", "少油", "不辣", "忌口", "爽口", "原汁原味",
        "清淡口", "清淡的", "清淡党",
    ],
    "roushi_baojun": [
        "肉", "牛肉", "鸡腿", "排骨", "鱼肉", "虾肉", "五花肉",
        "肉食", "荤", "肉山",
    ],
    "tanshui_xianren": [
        "分量", "量多", "管饱", "主食", "碳水", "饱腹",
        "量大", "给得多", "实惠",
    ],
    "tangshui_xintu": [
        "汤", "热乎", "热腾腾", "汤面", "汤粉",
        "面", "粉", "粉面", "面食",
    ],
    # ---- 新增 4 个行为类人设的评论关键词 ----
    "cailei_xianfeng": [
        "难吃", "踩雷", "翻车", "避雷", "难吃死", "失望",
        "不会再", "再也不", "难以下咽", "味同嚼蜡", "失望透顶",
        "坑", "骗", "浪费", "白花钱", "不值",
    ],
    "dushe_meishijia": [
        "不过如此", "名不副实", "一般般", "鸡肋", "将就",
        "也就那样", "凑合", "吐槽", "不敢恭维", "大失所望",
        "中规中矩", "平平无奇",
    ],
}

# ========== 反制关键词（对立人设互相减分） ==========
COUNTER_KEYWORDS = {
    "qingdan_yinshi": ["辣", "太辣", "油", "重口", "咸"],
    "lawei_dutu": ["不辣", "清淡", "爽口"],
}

COMMENT_COUNTER = {
    "qingdan_yinshi": ["辣", "辣度", "无辣不欢", "重口", "下饭", "油重", "油腻"],
    "lawei_dutu": ["不辣", "清淡", "爽口", "忌口", "养生"],
}


def _clean_tag(tag):
    """去除所有非中文字符，只留中文 + 数字"""
    return re.sub(r'[^\u4e00-\u9fff0-9]', '', str(tag)).strip()


def compute_persona(responses, window_map, top_n=3):
    """
    根据问卷回答计算人设标签（返回 Top N 个最匹配人设，最多 3 个）
    """
    top_n = min(top_n, 3)
    scores = {k: 0.0 for k in PERSONAS}
    total_evaluated = len(responses)

    if total_evaluated == 0:
        return []

    # ========== 行为特征统计 ==========
    satisfactions = []           # 所有满意度
    comment_lens = []            # 每条评论长度
    empty_comment_count = 0      # 空评论数量
    negative_tag_count = 0       # 负面标签总数
    positive_tag_count = 0       # 正面标签总数
    spicy_tag_count = 0
    light_tag_count = 0
    evaluated_cuisines = []
    evaluated_window_names = []

    for r in responses:
        wname = r.get("window_name", "")
        winfo = window_map.get(wname, {})
        cuisine = winfo.get("cuisine", "")

        evaluated_cuisines.append(cuisine)
        evaluated_window_names.append(wname)

        tags = r.get("tags", []) or []
        sat = r.get("satisfaction", 3)
        comment = r.get("comment", "") or ""

        satisfactions.append(sat)

        # 评论长度（clean 后的中文字数）
        comment_clean = _clean_tag(comment)
        comment_lens.append(len(comment_clean))
        if not comment_clean:
            empty_comment_count += 1

        # 标签正负统计
        for tag in tags:
            tc = _clean_tag(tag)
            if tc in NEGATIVE_TAG_CLEAN_WORDS:
                negative_tag_count += 1
            elif tc in POSITIVE_TAG_CLEAN_WORDS:
                positive_tag_count += 1

        # --- 1. 菜系打分 ---
        if cuisine in SOUP_NOODLE_CUISINES:
            scores["tangshui_xintu"] += 5
            scores["tanshui_xianren"] += 3
        if cuisine in LIGHT_CUISINES:
            scores["qingdan_yinshi"] += 5
        if cuisine in SPICY_CUISINES:
            scores["lawei_dutu"] += 5

        # --- 2. 窗口名关键词 ---
        for keyword in NOODLE_KEYWORDS:
            if keyword in wname:
                scores["tanshui_xianren"] += 3
                scores["tangshui_xintu"] += 2
                break
        for keyword in MEAT_KEYWORDS:
            if keyword in wname:
                scores["roushi_baojun"] += 3
                break

        # --- 3. 满意度权重 ---
        weight = sat / 3.0

        # --- 4. 标签分析 ---
        for tag in tags:
            tag_clean = _clean_tag(tag)
            if not tag_clean:
                continue

            for persona_key, keywords in PERSONA_TAG_KEYWORDS.items():
                for kw in keywords:
                    if kw in tag_clean:
                        scores[persona_key] += 4 * weight

            for persona_key, keywords in COUNTER_KEYWORDS.items():
                for kw in keywords:
                    if kw in tag_clean:
                        scores[persona_key] -= 2 * weight

            if any(kw in tag_clean for kw in ["辣", "太辣"]):
                spicy_tag_count += 1
            if any(kw in tag_clean for kw in ["清淡", "不辣"]):
                light_tag_count += 1

        # --- 5. 评论分析（权重 6，比标签高） ---
        if comment_clean:
            for persona_key, keywords in COMMENT_KEYWORDS.items():
                for kw in keywords:
                    if kw in comment_clean:
                        scores[persona_key] += 6 * weight

            for persona_key, keywords in COMMENT_COUNTER.items():
                for kw in keywords:
                    if kw in comment_clean:
                        scores[persona_key] -= 3 * weight

            if any(kw in comment_clean for kw in ["辣", "辣味", "香辣", "麻辣", "无辣不欢", "辣度"]):
                spicy_tag_count += 2
            if any(kw in comment_clean for kw in ["清淡", "不辣", "养生"]):
                light_tag_count += 2

    # ========== 6. 窗口海王 ==========
    # 极端行为保底：评 10+ 窗口直接拉满，不受口味类压制
    if total_evaluated >= 10:
        scores["chuangkou_haiwang"] = max(scores["chuangkou_haiwang"], 70)
    elif total_evaluated >= 8:
        scores["chuangkou_haiwang"] = max(scores["chuangkou_haiwang"], 58)
    elif total_evaluated >= 5:
        scores["chuangkou_haiwang"] += 16 + (total_evaluated - 5) * 3
    elif total_evaluated >= 4:
        scores["chuangkou_haiwang"] += 10
    elif total_evaluated >= 3:
        scores["chuangkou_haiwang"] += 5

    canteens = set()
    for wname in evaluated_window_names:
        winfo = window_map.get(wname, {})
        if winfo.get("canteen"):
            canteens.add(winfo["canteen"])
    if len(canteens) >= 2:
        scores["chuangkou_haiwang"] += 3

    # ========== 7. 对立口味反制 ==========
    spicy_cuisine_count = sum(1 for c in evaluated_cuisines if c in SPICY_CUISINES)
    light_cuisine_count = sum(1 for c in evaluated_cuisines if c in LIGHT_CUISINES)

    if spicy_cuisine_count > light_cuisine_count:
        scores["qingdan_yinshi"] -= (spicy_cuisine_count - light_cuisine_count) * 3
    elif light_cuisine_count > spicy_cuisine_count:
        scores["lawei_dutu"] -= (light_cuisine_count - spicy_cuisine_count) * 3

    if spicy_tag_count > light_tag_count:
        scores["qingdan_yinshi"] -= (spicy_tag_count - light_tag_count) * 3

    # ========== 8. 行为类人设评分（用统计特征） ==========
    avg_sat = statistics.mean(satisfactions) if satisfactions else 3
    try:
        sat_std = statistics.stdev(satisfactions) if len(satisfactions) > 1 else 0
    except statistics.StatisticsError:
        sat_std = 0
    avg_comment_len = statistics.mean(comment_lens) if comment_lens else 0
    empty_comment_pct = empty_comment_count / total_evaluated if total_evaluated else 0
    neg_tag_ratio = negative_tag_count / max(negative_tag_count + positive_tag_count, 1)

    # ---- 踩雷先锋：满意度低 + 负面标签多 ----
    # 端水大师（方差大）出现时 → 反制踩雷（因为不是"全都差"，是"有好有坏"）
    is_duanshui = (sat_std >= 1.2) and (negative_tag_count > 0 and positive_tag_count > 0)
    if avg_sat <= 2.5 and not is_duanshui:
        scores["cailei_xianfeng"] += (3 - avg_sat) * 8   # 越不满意分越高
    if neg_tag_ratio >= 0.5 and not is_duanshui:
        scores["cailei_xianfeng"] += neg_tag_ratio * 12
    if not is_duanshui:
        scores["cailei_xianfeng"] += negative_tag_count * 3

    # 踩雷先锋反制：高满意度 → 减踩雷分
    if avg_sat >= 4:
        scores["cailei_xianfeng"] -= (avg_sat - 3) * 5

    # ---- 沉默干饭人：评论为空的比例高 ----
    # 同时如果满意度普遍高（喜欢吃但不说），更实锤
    # 极端行为保底：100% 空评论 → 直接 95 分，不受口味类累积分压制
    # 但如果评了很多窗口（海王行为）→ 反制沉默（沉默≠海王）
    if empty_comment_pct >= 1.0:
        scores["chenmo_ganfanren"] = max(scores["chenmo_ganfanren"], 101)
    elif empty_comment_pct >= 0.7:
        scores["chenmo_ganfanren"] += 24
    elif empty_comment_pct >= 0.5:
        scores["chenmo_ganfanren"] += 16
    elif empty_comment_pct >= 0.3:
        scores["chenmo_ganfanren"] += 8

    # 沉默干饭人 bonus：满意度高（爱吃不说）
    if avg_sat >= 4 and empty_comment_pct >= 0.5:
        scores["chenmo_ganfanren"] += 8

    # 沉默 vs 海王 互斥：窗口太多 → 不叫沉默（你都评了 10 个窗口了还说自己沉默？）
    if total_evaluated >= 10:
        scores["chenmo_ganfanren"] -= 60
    elif total_evaluated >= 8:
        scores["chenmo_ganfanren"] -= 50

    # 沉默干饭人反制：评论长度长 → 减沉默分
    if avg_comment_len >= 15:
        scores["chenmo_ganfanren"] -= avg_comment_len * 0.6

    # ---- 毒舌美食家：评论覆盖率高 + 平均评论长 ----
    comment_cover_pct = 1 - empty_comment_pct
    if comment_cover_pct >= 0.7 and avg_comment_len >= 10:
        scores["dushe_meishijia"] += comment_cover_pct * 12 + avg_comment_len * 0.8

    # 毒舌 vs 沉默 互斥
    if empty_comment_pct >= 0.5:
        scores["dushe_meishijia"] -= 8

    # ---- 端水大师：满意度方差大（有的爱有的恨） + 正负标签都有 ----
    if sat_std >= 1.2:
        scores["duanshui_dashi"] += sat_std * 6
    if negative_tag_count > 0 and positive_tag_count > 0:
        scores["duanshui_dashi"] += 8
        ratio_diff = abs(negative_tag_count - positive_tag_count) / max(negative_tag_count, positive_tag_count)
        if ratio_diff < 0.5:
            scores["duanshui_dashi"] += 6  # 正负接近 → 端水实锤

    # 端水 vs 踩雷 互斥：有正有负且方差大 → 反制踩雷
    if is_duanshui:
        scores["cailei_xianfeng"] -= 10
        scores["duanshui_dashi"] += 4   # 再给端水加点分

    # ========== 9. 保底 ==========
    for k in scores:
        scores[k] = max(scores[k], 0.1)

    total_score = sum(scores.values())
    sorted_keys = sorted(scores, key=scores.get, reverse=True)
    top_keys = sorted_keys[:top_n]

    result = []
    for rank, key in enumerate(top_keys):
        pct = round(scores[key] / total_score * 100, 1)
        entry = PERSONAS[key].copy()
        entry["key"] = key
        entry["score"] = round(scores[key], 1)
        entry["pct"] = pct
        entry["rank"] = rank + 1
        result.append(entry)

    return result
