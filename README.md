# 🍱 食堂窗口菜品评价看板

一个基于 **Flask + ECharts** 的 Web 数据看板，展示食堂窗口菜品评价的统计分析和可视化图表。

## 快速开始

### 1. 创建 conda 环境（只需第一次）

```bash
conda create -n da python=3.10 -y
conda activate da
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 启动服务

```bash
python app.py
```

浏览器自动访问 **http://127.0.0.1:8000** 即可看到看板。

> ⚠️ 注意：5000 端口被 VMware NAT (vmnat.exe) 占用，已改用 8000 端口。

## 功能一览

| 页面区域 | 展示内容 |
|----------|----------|
| 顶部标题栏 | 看板标题 + 数据来源标识 + 数据更新时间 |
| 侧边栏 | 数据源切换（模拟/问卷/上传）、菜系类型快捷筛选、**去填评价问卷**入口 |
| 搜索框 | 输入关键词搜索菜品/窗口/评价文字 |
| 统计卡片（4张） | 总评价数、整体平均分、最高分窗口、最低分窗口 |
| 图表区（6张） | 窗口平均分柱状图、评分分布饼图、热度排行、菜系类型对比、价格评分散点图、关键词词云 |
| 数据表格 | 分页浏览原始评价数据 + CSV 下载 |

## 🆕 自建问卷功能

项目内置了自建问卷页面（不依赖问卷星/收集表等第三方工具）：

- **问卷入口**：侧边栏点击「✍️ 去填评价问卷」或直接访问 `http://127.0.0.1:8000/survey`
- **问题形式**：每个食堂窗口一张卡片，配窗口图片、5星满意度评分、多选标签（正面/负面）、自由备注文本域
- **数据存储**：SQLite（Python 自带，零依赖），数据库文件在 `data/survey.db`
- **对接看板**：提交后自动切换数据源，也可在侧边栏手动切换「📝 问卷收集数据」查看

问卷 API 列表：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/survey` | 问卷页面 |
| GET | `/api/survey/windows` | 返回窗口配置 + 预设标签 |
| POST | `/api/survey/submit` | 提交问卷（批量保存多条记录） |
| GET | `/api/survey/records` | 查询问卷记录统计 |

数据源切换 API：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/source` | 切换数据源：`mock` / `survey` / `upload` |

## 支持的数据字段

上传文件需包含以下列：
- **必需**：窗口名、菜品名、评分
- **可选**：菜系类型、价格、评价文字、日期

支持 `.csv` 和 `.xlsx` 格式。

## 项目结构

```
app.py                  # Flask 主入口 + API 路由
requirements.txt        # Python 依赖
utils/
  mock_data.py          # 模拟数据生成（8 个食堂窗口，200 条评价）
  data_loader.py        # 数据加载 + pandas 聚合计算
  text_analyzer.py      # jieba 分词 + 词频统计
templates/
  index.html            # 页面模板
static/
  css/style.css         # 橙黄色主题样式
  js/main.js            # fetch API + ECharts 渲染
```

## API 列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 页面首页 |
| GET | `/api/stats?search=&cuisine=` | 统计卡片数据 |
| GET | `/api/charts?search=&cuisine=` | 全部图表数据 |
| GET | `/api/table?page=&size=` | 分页原始数据 |
| GET | `/api/cuisines` | 菜系类型列表 |
| GET | `/api/download` | 下载 CSV |
| POST | `/api/upload` | 上传 Excel/CSV |
| GET | `/api/reset` | 重置回模拟数据 |

## 数据说明

默认加载 200 条模拟数据，包含 8 个食堂窗口：川香小炒、广式糖水、兰州拉面、家常菜馆、麻辣香锅、西式简餐、水饺馄饨、干锅烤鱼。数据有真实感：麻辣香锅口碑较好、兰州拉面评分偏低。
