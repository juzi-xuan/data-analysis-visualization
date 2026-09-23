# -*- coding: utf-8 -*-
"""
食堂窗口配置（真实窗口 + 本地图片）
- 所有窗口从 static/images 目录自动生成
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
    "🥗健康",
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

# 菜品级快速标签（每个菜品评价行里用，简洁快速）
DISH_TAGS_POSITIVE = [
    "👍好吃",
    "🥘分量足",
    "🌿新鲜",
    "🔥够味",
    "💰实惠",
    "🥣热乎",
]

DISH_TAGS_NEGATIVE = [
    "😐一般",
    "🫙太油",
    "🍜量少",
    "💸偏贵",
    "🧂太咸",
    "🥶偏凉",
]

# 全部食堂窗口（56 个，从 images 目录生成）
WINDOWS = [
    {
        "name": "兰州拉面（一食堂周边）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/兰州拉面（一食堂周边）.jpg",
    },
    {
        "name": "刘福恺炸鸡腿（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "小吃快餐",
        "image": "/static/images/刘福恺炸鸡腿（一食堂三楼）.jpg",
    },
    {
        "name": "刘记烧腊饭（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/刘记烧腊饭（一食堂一楼）.jpg",
    },
    {
        "name": "包点很忙（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "面点",
        "image": "/static/images/包点很忙（一食堂二楼）.jpg",
    },
    {
        "name": "北京烤鸭热卤饭（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/北京烤鸭热卤饭（一食堂三楼）.jpg",
    },
    {
        "name": "北方烤饼（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "面食",
        "image": "/static/images/北方烤饼（二食堂一楼）.jpg",
    },
    {
        "name": "阿狸糖水铺（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "饮品甜品",
        "image": "/static/images/阿狸糖水铺（二食堂一楼）.jpg",
    },
    {
        "name": "常德津市牛肉粉（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "面食",
        "image": "/static/images/常德津市牛肉粉（二食堂一楼）.jpg",
    },
    {
        "name": "翰林包子铺（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "面点",
        "image": "/static/images/翰林包子铺（二食堂一楼）.jpg",
    },
    {
        "name": "滑蛋饭，肠粉（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "粤式点心",
        "image": "/static/images/滑蛋饭，肠粉（二食堂一楼）.jpg",
    },
    {
        "name": "面面俱到（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "面食",
        "image": "/static/images/面面俱到（二食堂一楼）.jpg",
    },
    {
        "name": "精美大餐（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "家常菜",
        "image": "/static/images/精美大餐（二食堂一楼）.jpg",
    },
    {
        "name": "南方面点（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "面点",
        "image": "/static/images/南方面点（一食堂一楼）.jpg",
    },
    {
        "name": "周妈麻辣烫（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "小吃快餐",
        "image": "/static/images/周妈麻辣烫（一食堂三楼）.jpg",
    },
    {
        "name": "大伙灶（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/大伙灶（一食堂一楼）.jpg",
    },
    {
        "name": "大伙灶（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/大伙灶（一食堂二楼）.jpg",
    },
    {
        "name": "大火灶（一食堂）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/大火灶（一食堂）.jpg",
    },
    {
        "name": "小时光西点屋（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "面包甜品",
        "image": "/static/images/小时光西点屋（一食堂一楼）.jpg",
    },
    {
        "name": "小碗当家（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/小碗当家（一食堂二楼）.jpg",
    },
    {
        "name": "小碗菜（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/小碗菜（一食堂三楼）.jpg",
    },
    {
        "name": "平江特色粉面（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/平江特色粉面（一食堂一楼）.jpg",
    },
    {
        "name": "广式肠粉（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "粤式点心",
        "image": "/static/images/广式肠粉（一食堂三楼）.jpg",
    },
    {
        "name": "无名氏（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/无名氏（一食堂一楼）.jpg",
    },
    {
        "name": "朝阳洲牛肉粉面（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/朝阳洲牛肉粉面（一食堂一楼）.jpg",
    },
    {
        "name": "柳无双柳州螺蛳粉（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "特色粉面",
        "image": "/static/images/柳无双柳州螺蛳粉（一食堂二楼）.jpg",
    },
    {
        "name": "毛氏卤肉饭（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/毛氏卤肉饭（一食堂三楼）.jpg",
    },
    {
        "name": "水煮鱼（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "川菜",
        "image": "/static/images/水煮鱼（一食堂三楼）.jpg",
    },
    {
        "name": "湘乡银丝粉（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/湘乡银丝粉（一食堂二楼）.jpg",
    },
    {
        "name": "湘味蒸菜（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/湘味蒸菜（一食堂一楼）.jpg",
    },
    {
        "name": "烤盘饭·重庆鸡公煲（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "焖锅",
        "image": "/static/images/烤盘饭·重庆鸡公煲（一食堂三楼）.jpg",
    },
    {
        "name": "烤肉虾仁捞双拌饭（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/烤肉虾仁捞双拌饭（一食堂一楼）.jpg",
    },
    {
        "name": "烧腊饭套餐（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/烧腊饭套餐（一食堂二楼）.jpg",
    },
    {
        "name": "牛鲜生粉面（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/牛鲜生粉面（一食堂三楼）.jpg",
    },
    {
        "name": "王喜峰麻辣烫（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "小吃快餐",
        "image": "/static/images/王喜峰麻辣烫（二食堂一楼）.jpg",
    },
    {
        "name": "任大泡湘西泡菜（二食堂附近）",
        "canteen": "二食堂",
        "cuisine": "小吃快餐",
        "image": "/static/images/任大泡湘西泡菜（二食堂附近）.jpg",
    },
    {
        "name": "精品粮自选（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "家常菜",
        "image": "/static/images/精品粮自选（二食堂一楼）.jpg",
    },
    {
        "name": "258盖码饭（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/258盖码饭（二食堂二楼）.jpg",
    },
    {
        "name": "卤味铺子（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "小吃快餐",
        "image": "/static/images/卤味铺子（二食堂二楼）.jpg",
    },
    {
        "name": "卤牛肉面（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "面食",
        "image": "/static/images/卤牛肉面（二食堂二楼）.jpg",
    },
    {
        "name": "台湾卤肉盖浇饭（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/台湾卤肉盖浇饭（二食堂二楼）.jpg",
    },
    {
        "name": "土豆泥拌饭（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/土豆泥拌饭（二食堂二楼）.jpg",
    },
    {
        "name": "油泼面（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "面食",
        "image": "/static/images/油泼面（二食堂二楼）.jpg",
    },
    {
        "name": "小碗菜（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "家常菜",
        "image": "/static/images/小碗菜（二食堂二楼）.jpg",
    },
    {
        "name": "徐大川剁椒猪脚饭（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/徐大川剁椒猪脚饭（二食堂二楼）.jpg",
    },
    {
        "name": "自选餐区（二食堂二楼）",
        "canteen": "二食堂",
        "cuisine": "家常菜",
        "image": "/static/images/自选餐区（二食堂二楼）.jpg",
    },
    {
        "name": "精品粮贩自选（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/精品粮贩自选（一食堂二楼）.jpg",
    },
    {
        "name": "自选（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/自选（一食堂一楼）.jpg",
    },
    {
        "name": "蒸排骨饭（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "家常菜",
        "image": "/static/images/蒸排骨饭（一食堂二楼）.jpg",
    },
    {
        "name": "袁记云饺（一食堂一楼）",
        "canteen": "一食堂",
        "cuisine": "面点",
        "image": "/static/images/袁记云饺（一食堂一楼）.jpg",
    },
    {
        "name": "里手馄饨粉面（一食堂三楼）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/里手馄饨粉面（一食堂三楼）.jpg",
    },
    {
        "name": "重庆小面（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "面食",
        "image": "/static/images/重庆小面（一食堂二楼）.jpg",
    },
    {
        "name": "隆江猪脚饭（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/隆江猪脚饭（一食堂二楼）.jpg",
    },
    {
        "name": "韩国料理（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "韩式",
        "image": "/static/images/韩国料理（一食堂二楼）.jpg",
    },
    {
        "name": "饭拾一五花肉拌饭（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/饭拾一五花肉拌饭（一食堂二楼）.jpg",
    },
    {
        "name": "黄太爷焖锅（一食堂二楼）",
        "canteen": "一食堂",
        "cuisine": "焖锅",
        "image": "/static/images/黄太爷焖锅（一食堂二楼）.jpg",
    },
    {
        "name": "黄焖鸡（二食堂一楼）",
        "canteen": "二食堂",
        "cuisine": "盖浇饭",
        "image": "/static/images/黄焖鸡（二食堂一楼）.jpg",
    },
]

# 窗口名 → 菜系类型 的快速查找字典
WINDOW_CUISINE_MAP = {w["name"]: w["cuisine"] for w in WINDOWS}

# 窗口名 → 完整配置 的快速查找字典
# 首页/窗口口碑页要拿食堂、菜系、图片，用这个一次取全
WINDOW_INFO_MAP = {w["name"]: w for w in WINDOWS}
