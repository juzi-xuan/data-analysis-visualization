# -*- coding: utf-8 -*-
"""
中文评价文本分析
- jieba 分词
- 停用词过滤
- 词频统计（给 ECharts 词云用）
"""

import re
from collections import Counter

# jieba 是可选依赖，没有就跳过分词（词云返回空）
try:
    import jieba
    _HAS_JIEBA = True
except ImportError:
    _HAS_JIEBA = False

# 停用词表（常见但无意义的词）
STOP_WORDS = {
    # 助词
    "的", "了", "是", "在", "我", "有", "和", "就",
    "不", "人", "都", "一", "一个", "上", "也", "很",
    "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "那", "啊", "呢", "吧",
    "哦", "呀", "嗯", "么", "啦", "嘛", "哇", "哟",
    # 数字和符号
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
    # 无意义高频
    "还", "但", "但是", "不过", "然后", "之后", "因为", "所以",
    "什么", "怎么", "这样", "那样", "怎么", "怎么样",
    "真的", "确实", "实在", "比较", "稍微", "有点", "一些",
    "没什么", "没什么特别", "一般般", "中规中矩",
}

# 额外保留的"有意义"的词（避免被误过滤）
KEEP_WORDS = {
    "好吃", "干净", "卫生", "分量", "排队", "咸", "淡", "价格",
    "合理", "贵", "便宜", "服务", "态度", "环境", "新鲜", "够味",
    "口感", "香", "嫩", "热乎", "正宗", "性价比", "推荐",
}


def compute_word_freq(df) -> list:
    """
    从 DataFrame 的"评价文字"列中提取词频

    Returns:
        list of [word, freq]，按频率降序，最多 50 个
    """
    if df.empty or "评价文字" not in df.columns:
        return []

    if not _HAS_JIEBA:
        print("[text_analyzer] jieba 未安装，跳过词频分析")
        return []

    # 合并所有评价文字
    text = " ".join(df["评价文字"].fillna("").astype(str).tolist())

    # 分词
    words = jieba.cut(text)

    # 过滤停用词 + 单字 + 纯数字/符号
    cleaned = []
    for w in words:
        w = w.strip()
        if not w:
            continue
        # 跳过停用词
        if w in STOP_WORDS:
            continue
        # 跳过单字（除非在保留列表里）
        if len(w) < 2 and w not in KEEP_WORDS:
            continue
        # 跳过纯数字
        if w.isdigit():
            continue
        # 跳过纯标点
        if re.match(r"^[\s\W]+$", w):
            continue
        cleaned.append(w)

    # 统计词频
    freq = Counter(cleaned).most_common(50)

    # 转成 ECharts 词云需要的格式: [[word, freq], ...]
    return [[word, count] for word, count in freq]


if __name__ == "__main__":
    # 快速测试
    from utils.mock_data import generate_canteen_data
    df = generate_canteen_data(200)
    freq = compute_word_freq(df)
    print("=== 词频 TOP 20 ===")
    for word, count in freq[:20]:
        print(f"  {word}: {count}")
