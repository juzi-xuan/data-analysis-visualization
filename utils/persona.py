# -*- coding: utf-8 -*-
"""
人设标签匹配引擎
根据用户问卷数据，匹配出专属的食堂人设标签
"""

# 人设定义：key → { 中文名, 图片文件名, 描述 }
PERSONAS = {
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
}

# 汤水面食类菜系
SOUP_NOODLE_CUISINES = {"面食", "湖南菜", "江西菜"}

# 清淡类菜系
LIGHT_CUISINES = {"家常菜"}

# 辣味菜系
SPICY_CUISINES = {"川菜", "湘菜", "湖南菜", "江西菜"}

# 荤肉类关键词（窗口名包含这些的偏向肉食）
MEAT_KEYWORDS = ["牛肉", "肉", "鸡", "排骨", "鱼", "虾"]

# 面食关键词
NOODLE_KEYWORDS = ["面", "粉", "饼"]


def compute_persona(responses, window_map):
    """
    根据问卷回答计算人设标签
    
    Args:
        responses: 提交的评价列表
            [{ window_name, satisfaction, tags, comment, dish_evaluations }]
        window_map: 窗口名 → 窗口配置 的字典（含 cuisine, canteen 等）
    
    Returns:
        dict: 人设信息 { name, image, desc, key }
    """
    scores = {k: 0 for k in PERSONAS}
    
    total_evaluated = len(responses)
    
    # 收集所有被评价窗口的属性
    evaluated_cuisines = []
    evaluated_window_names = []
    all_tags = []
    
    for r in responses:
        wname = r.get("window_name", "")
        winfo = window_map.get(wname, {})
        cuisine = winfo.get("cuisine", "")
        
        evaluated_cuisines.append(cuisine)
        evaluated_window_names.append(wname)
        
        # 收集标签
        tags = r.get("tags", []) or []
        all_tags.extend(tags)
        
        # 根据菜系打分
        if cuisine in SOUP_NOODLE_CUISINES:
            scores["tangshui_xintu"] += 3
            scores["tanshui_xianren"] += 2
        
        if cuisine in LIGHT_CUISINES:
            scores["qingdan_yinshi"] += 3
        
        if cuisine in SPICY_CUISINES:
            scores["lawei_dutu"] += 2
        
        # 根据窗口名关键词
        for keyword in NOODLE_KEYWORDS:
            if keyword in wname:
                scores["tanshui_xianren"] += 2
                scores["tangshui_xintu"] += 1
                break
        
        for keyword in MEAT_KEYWORDS:
            if keyword in wname:
                scores["roushi_baojun"] += 2
                break
        
        # 根据评价的满意度（高分的权重更大）
        score = r.get("satisfaction", 3)
        weight = score / 3.0  # 5分权重 ~1.67，1分权重 ~0.33
        
        # 标签分析
        for tag in tags:
            tag_clean = tag.replace("⭐", "").replace("✨", "").replace("🔥", "").replace("🌿", "")
            
            if "辣" in tag_clean:
                scores["lawei_dutu"] += 3 * weight
            if "够味" in tag_clean:
                scores["lawei_dutu"] += 1.5 * weight
            if "油" in tag_clean or "清" in tag_clean or "淡" in tag_clean:
                scores["qingdan_yinshi"] += 1.5 * weight
            if "分量" in tag_clean:
                scores["tanshui_xianren"] += 1 * weight
            if "好吃" in tag_clean:
                # 通用加分
                pass
    
    # 根据评价窗口数量 → 窗口海王
    # 评价 >= 4 个窗口 → 强力加分
    if total_evaluated >= 5:
        scores["chuangkou_haiwang"] += 10 + (total_evaluated - 5) * 3
    elif total_evaluated >= 4:
        scores["chuangkou_haiwang"] += 7
    elif total_evaluated >= 3:
        scores["chuangkou_haiwang"] += 3
    
    # 如果评价窗口跨了两个食堂，再加一点海王分
    canteens = set()
    for wname in evaluated_window_names:
        winfo = window_map.get(wname, {})
        if winfo.get("canteen"):
            canteens.add(winfo["canteen"])
    if len(canteens) >= 2:
        scores["chuangkou_haiwang"] += 1.5
    
    # === 归一化 + 选出最高分 ===
    # 保底每个至少 0.1 分，避免全 0
    for k in scores:
        scores[k] = max(scores[k], 0.1)
    
    # 找出最高分
    best_key = max(scores, key=scores.get)
    best_score = scores[best_key]
    
    # 检查是否有并列（差距 < 0.5），有的话加一点随机但稳定的偏好
    tied_keys = [k for k, v in scores.items() if abs(v - best_score) < 0.5]
    if len(tied_keys) > 1:
        # 用评价数量做一点偏向
        # 评价窗口多的稍微偏向"窗口海王"，否则选第一个
        if total_evaluated >= 3 and "chuangkou_haiwang" in tied_keys:
            best_key = "chuangkou_haiwang"
        else:
            # 选并列里的第一个（稳定排序）
            tied_keys_sorted = sorted(tied_keys)
            best_key = tied_keys_sorted[0]
    
    result = PERSONAS[best_key].copy()
    result["key"] = best_key
    
    # 附加分数信息（调试用）
    result["_scores"] = scores
    
    return result
