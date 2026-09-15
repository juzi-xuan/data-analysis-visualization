# -*- coding: utf-8 -*-
"""
食堂窗口评价的模拟数据生成器
用于在没有真实问卷数据时展示看板效果
** 已扩展：同时生成 tags 字段（正面/负面标签），支撑维度评分计算
"""

import json
import random
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

# --- 标签库 ---
POS_TAGS = ["好吃", "干净卫生", "服务好", "分量足", "价格实惠", "口味正宗", "食材新鲜", "出餐快","健康"]
NEG_TAGS = ["味道一般", "油太重", "量太少", "价格偏贵", "太辣了", "食物偏凉", "卫生一般", "排队太久"]

# 维度 → 相关关键词映射（用于从 tags 提取维度分）
DIMENSION_POS = {
    "口味": ["好吃", "口味正宗"],
    "分量": ["分量足"],
    "性价比": ["价格实惠"],
    "卫生": ["干净卫生", "食材新鲜"],
    "速度": ["出餐快"],
}
DIMENSION_NEG = {
    "口味": ["味道一般", "太辣了"],
    "分量": ["量太少"],
    "性价比": ["价格偏贵"],
    "卫生": ["卫生一般"],
    "速度": ["排队太久"],
}

# 7 个真实食堂窗口，每个窗口有多个菜品和菜系类型
WINDOWS = {
    "兰州拉面（一食堂周边）": {
        "菜系": "面食",
        "菜品": ["牛肉拉面", "凉拌黄瓜", "酱牛肉", "茶叶蛋"],
        "基础评分": 4.0,
    },
    "北方烤饼（二食堂一楼）": {
        "菜系": "面食",
        "菜品": ["酱香烤饼", "鸡蛋灌饼", "肉夹馍", "油酥烧饼"],
        "基础评分": 3.9,
    },
    "平江特色粉面（一食堂一楼）": {
        "菜系": "湖南菜",
        "菜品": ["平江酱干面", "酸辣粉", "肉丝炒面", "蒸饺"],
        "基础评分": 4.1,
    },
    "朝阳洲牛肉粉面（一食堂一楼）": {
        "菜系": "江西菜",
        "菜品": ["牛肉粉", "拌粉", "肉丝粉", "瓦罐汤"],
        "基础评分": 4.2,  # 招牌口碑好
    },
    "王喜峰麻辣烫（二食堂一楼）": {
        "菜系": "川菜",
        "菜品": ["自选麻辣烫", "麻辣香锅", "冒菜", "口水鸡"],
        "基础评分": 4.3,  # 麻辣烫最受欢迎
    },
    "精品粮自选（二食堂一楼）": {
        "菜系": "家常菜",
        "菜品": ["红烧肉", "番茄炒蛋", "青椒土豆丝", "蒜蓉西兰花"],
        "基础评分": 3.8,
    },
    "黄焖鸡（二食堂一楼）": {
        "菜系": "家常菜",
        "菜品": ["黄焖鸡米饭", "排骨米饭", "鸡柳米饭", "肥牛米饭"],
        "基础评分": 3.9,
    },
}

# 评价文字模板，用于生成真实感的评价
COMMENT_TEMPLATES = [
    "味道真不错，{adj}，下次还来！",
    "{adj}，分量也足，价格合理。",
    "{neg}，但整体还行吧。",
    "非常{adj}，推荐给大家！",
    "一般般吧，{neg}。",
    "还行，{adj}，就是排队有点久。",
    "{adj}，{neg}。",
    "服务态度好，环境{adj}。",
    "性价比{adj}，值得一尝。",
    "{neg}，需要改进。",
    "中规中矩，没什么特别的。",
    "超{adj}！强烈推荐！",
    "老板{adj}，会常来。",
    "菜品{adj}，新鲜{adj}。",
    "有点{neg}，希望能改善。",
]

# 好的形容词
GOOD_ADJ = [
    "好吃", "够味", "干净卫生", "香", "嫩", "美味", "好吃不贵",
    "实惠", "新鲜", "热乎", "口感好", "味道正宗", "分量足",
    "服务好", "环境不错", "物超所值",
]

# 不好的形容词
BAD_ADJ = [
    "偏咸", "偏淡", "太油", "排队太久", "价格偏贵", "量少",
    "味道一般", "等待时间长", "有点凉", "不够入味", "太辣了",
    "卫生一般", "性价比低",
]


def _gen_comment(score: float) -> str:
    """根据评分生成带倾向的评价文字"""
    # 评分越高，正面词汇越多
    if score >= 4.2:
        adj = random.choice(GOOD_ADJ)
        neg = random.choice(BAD_ADJ[:5])  # 轻微缺点
        return random.choice(COMMENT_TEMPLATES).format(adj=adj, neg=neg)
    elif score >= 3.5:
        if random.random() < 0.6:
            adj = random.choice(GOOD_ADJ)
            neg = random.choice(BAD_ADJ)
        else:
            adj = random.choice(GOOD_ADJ[:5])
            neg = random.choice(BAD_ADJ)
        return random.choice(COMMENT_TEMPLATES).format(adj=adj, neg=neg)
    else:
        adj = random.choice(GOOD_ADJ[:3])  # 只有很少正面
        neg = random.choice(BAD_ADJ)
        return random.choice(COMMENT_TEMPLATES).format(adj=adj, neg=neg)


def _gen_price(base: float, price_boost: float = 0) -> float:
    """生成带一点随机波动的价格"""
    price = base + random.uniform(-2, 3) + price_boost
    return round(max(3, price), 1)


def _gen_tags(score: float) -> str:
    """根据评分生成标签列表（JSON 字符串）"""
    tags = []
    # 评分越高，加的正面标签越多；越低，负面标签越多
    if score >= 4.3:
        n_pos = random.randint(2, 4)
        n_neg = random.randint(0, 1)
    elif score >= 3.5:
        n_pos = random.randint(1, 2)
        n_neg = random.randint(0, 2)
    elif score >= 2.5:
        n_pos = random.randint(0, 1)
        n_neg = random.randint(1, 3)
    else:
        n_pos = random.randint(0, 1)
        n_neg = random.randint(2, 4)

    tags.extend(random.sample(POS_TAGS, n_pos))
    tags.extend(random.sample(NEG_TAGS, n_neg))
    return json.dumps(tags, ensure_ascii=False)


def generate_canteen_data(n: int = 200, seed: int = 42) -> pd.DataFrame:
    """
    生成食堂窗口评价的模拟数据

    Args:
        n: 要生成的评价数量（默认 200）
        seed: 随机种子，保证可复现

    Returns:
        DataFrame，字段：窗口名、菜品名、菜系类型、评分、价格、评价文字、日期
    """
    random.seed(seed)
    np.random.seed(seed)

    records = []

    # 先把每个窗口-菜品组合列出来，保证覆盖面
    all_combinations = []
    for window_name, info in WINDOWS.items():
        for dish in info["菜品"]:
            all_combinations.append((window_name, dish, info))

    # 随机抽取 n 条评价
    for _ in range(n):
        window_name, dish, info = random.choice(all_combinations)

        # 评分：围绕窗口基础评分做正态分布，截到 1-5
        base = info["基础评分"]
        score = np.random.normal(base, 0.7)
        score = round(max(1.0, min(5.0, score)), 1)

        # 价格
        price_boost = info.get("价格上浮", 0)
        price = _gen_price(random.uniform(8, 18), price_boost)

        # 评价文字
        comment = _gen_comment(score)

        # 日期：最近 30 天内随机
        days_ago = random.randint(0, 30)
        date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
        # 投票状态：随机 10% 投票
        voted = random.random() < 0.1
        
        records.append({
            "窗口名": window_name,
            "菜品名": dish,
            "菜系类型": info["菜系"],
            "评分": score,
            "价格": price,
            "评价文字": comment,
            "日期": date,
            "tags": _gen_tags(score),
            "voted": voted, 
        })

    df = pd.DataFrame(records)

    # 打乱顺序，让日期和窗口分布更自然
    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)

    return df


if __name__ == "__main__":
    # 直接运行时打印一些统计来验证数据质量
    df = generate_canteen_data(200)
    print("=== 模拟数据概览 ===")
    print(f"数据条数: {len(df)}")
    print(f"字段: {list(df.columns)}")
    print()
    print("=== 各窗口平均分 ===")
    print(df.groupby("窗口名")["评分"].mean().sort_values(ascending=False).round(2))
    print()
    print("=== 菜系类型分布 ===")
    print(df["菜系类型"].value_counts())
    print()
    print("=== 评分分布 ===")
    print(df["评分"].value_counts().sort_index())
