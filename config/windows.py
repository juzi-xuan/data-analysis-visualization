# -*- coding: utf-8 -*-
"""
食堂窗口配置（真实窗口）
- 7 个真实窗口 + 本地图片
- 统一管理，问卷页面和看板都引用这里
"""

# 预设的多选标签（正面 + 负面）
POSITIVE_TAGS = [
    "⭐好吃",
    "✨干净卫生",
    "👨‍🍳服务好",
    "🥘分量足",
    "💰价格实惠",
    "🔥口味正宗",
    "🌿食材新鲜",
    "⚡出餐快",
]

NEGATIVE_TAGS = [
    "⚠️需要改进",
    "❌味道一般",
    "💧油太重",
    "🍜量太少",
    "💸价格偏贵",
    "😵太辣了",
    "🥶食物偏凉",
    "🪳卫生一般",
]

# 7 个真实食堂窗口
WINDOWS = [
    {
        "name": "兰州拉面",
        "cuisine": "面食",
        "image": "/static/images/兰州拉面（一食堂周边）.jpg",
    },
    {
        "name": "北方烤饼",
        "cuisine": "面食",
        "image": "/static/images/北方烤饼（二食堂）.jpg",
    },
    {
        "name": "平江特色粉面",
        "cuisine": "湖南菜",
        "image": "/static/images/平江特色粉面（一食堂一楼）.jpg",
    },
    {
        "name": "朝阳洲牛肉粉面",
        "cuisine": "江西菜",
        "image": "/static/images/朝阳洲牛肉粉面（一食堂一楼）.jpg",
    },
    {
        "name": "王喜峰麻辣烫",
        "cuisine": "川菜",
        "image": "/static/images/王喜峰麻辣烫（二食堂）.jpg",
    },
    {
        "name": "精品粮自选",
        "cuisine": "家常菜",
        "image": "/static/images/精品粮自选（二食堂）.jpg",
    },
    {
        "name": "黄焖鸡",
        "cuisine": "家常菜",
        "image": "/static/images/黄焖鸡（二食堂）.jpg",
    },
]

# 窗口名 → 菜系类型 的快速查找字典
WINDOW_CUISINE_MAP = {w["name"]: w["cuisine"] for w in WINDOWS}
