// ============================================================
// 食堂评价看板 - 前端逻辑
// 负责：请求后端 API、渲染统计卡片、ECharts 图表、数据表格
// ============================================================

// ============ 全局状态 ============
const state = {
    search: "",
    cuisine: "全部",
    page: 1,
    size: 20,
    dataSource: "模拟数据",
};

// ECharts 实例缓存
const charts = {};

// ECharts 统一配色（橙黄暖色调）
const COLORS = ["#FF6B35", "#FFB347", "#FFD700", "#E85D75", "#6AB04C", "#4A90D9", "#9B59B6", "#1ABC9C"];


// ============ 页面加载 ============
window.onload = async () => {
    console.log("🍱 食堂评价看板前端已加载");
    await init();
    bindEvents();
};

async function init() {
    // 初始化所有 ECharts 实例（先创建容器）
    initCharts();
    // 加载菜系筛选标签
    await loadCuisines();
    // 加载所有数据
    await loadAllData();
}

function initCharts() {
    const chartIds = [
        "chart-window-avg",
        "chart-score-dist",
        "chart-window-rank",
        "chart-cuisine-score",
        "chart-price-scatter",
        "chart-wordcloud",
    ];
    chartIds.forEach(id => {
        const dom = document.getElementById(id);
        if (dom) {
            charts[id] = echarts.init(dom, null, { renderer: "canvas" });
        }
    });

    // 窗口大小变化时重绘
    window.addEventListener("resize", () => {
        Object.values(charts).forEach(c => c.resize());
    });
}


// ============ 绑定事件 ============
function bindEvents() {
    // 数据源切换
    const sourceSelect = document.getElementById("source-select");
    if (sourceSelect) {
        sourceSelect.addEventListener("change", async (e) => {
            const target = e.target.value;
            await switchSource(target);
        });
    }

    // 搜索框（debounce 300ms）
    let searchTimer = null;
    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            state.search = e.target.value.trim();
            state.page = 1;
            await loadAllData();
        }, 300);
    });

    // 文件上传
    const fileUpload = document.getElementById("file-upload");
    fileUpload.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const msgEl = document.getElementById("upload-msg");
        msgEl.className = "upload-msg";
        msgEl.textContent = "⏳ 上传中...";

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/api/upload", { method: "POST", body: formData });
            const data = await res.json();
            if (data.ok) {
                msgEl.className = "upload-msg success";
                msgEl.textContent = "✅ " + data.msg;
                state.dataSource = data.data_source;
                // 重新加载所有
                await loadCuisines();
                await loadAllData();
                // 更新顶部显示
                document.getElementById("data-source-badge").textContent =
                    "📊 " + data.data_source;
                document.getElementById("header-date").textContent = data.data_date;
            } else {
                msgEl.className = "upload-msg error";
                msgEl.textContent = "❌ " + data.msg;
            }
        } catch (err) {
            msgEl.className = "upload-msg error";
            msgEl.textContent = "❌ 上传失败: " + err.message;
        }
    });

    // 重置按钮
    document.getElementById("reset-btn").addEventListener("click", async () => {
        const res = await fetch("/api/reset");
        await res.json();
        document.getElementById("data-source-badge").textContent = "📊 模拟数据";
        document.getElementById("upload-msg").textContent = "";
        await loadCuisines();
        await loadAllData();
    });

    // 下载 CSV
    document.getElementById("download-btn").addEventListener("click", () => {
        const params = new URLSearchParams();
        if (state.search) params.set("search", state.search);
        if (state.cuisine && state.cuisine !== "全部") params.set("cuisine", state.cuisine);
        window.location.href = "/api/download?" + params.toString();
    });

    // 分页按钮
    document.getElementById("prev-page").addEventListener("click", () => {
        if (state.page > 1) {
            state.page--;
            loadTable();
        }
    });
    document.getElementById("next-page").addEventListener("click", () => {
        state.page++;
        loadTable();
    });
}


// ============ 切换数据源 ============
async function switchSource(target) {
    try {
        const res = await fetch("/api/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: target }),
        });
        const data = await res.json();
        if (!data.ok) {
            alert("❌ " + data.msg);
            // 回退下拉选择
            const sel = document.getElementById("source-select");
            sel.value = sel.dataset.prev || "mock";
            return;
        }

        state.dataSource = data.data_source;
        document.getElementById("data-source-badge").textContent = "📊 " + data.data_source;
        document.getElementById("header-date").textContent = data.data_date;

        // 重置筛选 + 刷新
        state.search = "";
        state.cuisine = "全部";
        state.page = 1;
        const sel = document.getElementById("source-select");
        sel.dataset.prev = target;

        await loadCuisines();
        await loadAllData();
    } catch (err) {
        alert("切换失败: " + err.message);
    }
}


// ============ 菜系类型筛选标签 ============
async function loadCuisines() {
    const res = await fetch("/api/cuisines");
    const cuisines = await res.json();

    const container = document.getElementById("cuisine-tags");
    container.innerHTML = "";
    cuisines.forEach(c => {
        const tag = document.createElement("div");
        tag.className = "filter-tag" + (c === state.cuisine ? " active" : "");
        tag.textContent = c;
        tag.onclick = async () => {
            state.cuisine = c;
            state.page = 1;
            // 更新标签样式
            container.querySelectorAll(".filter-tag").forEach(t => t.classList.remove("active"));
            tag.classList.add("active");
            await loadAllData();
        };
        container.appendChild(tag);
    });
}


// ============ 加载所有数据 ============
async function loadAllData() {
    // 并行请求 stats 和 charts
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.cuisine && state.cuisine !== "全部") params.set("cuisine", state.cuisine);

    const [statsRes, chartsRes] = await Promise.all([
        fetch("/api/stats?" + params.toString()),
        fetch("/api/charts?" + params.toString()),
    ]);

    const stats = await statsRes.json();
    const chartsData = await chartsRes.json();

    renderStats(stats);
    renderCharts(chartsData);
    await loadTable();
}


// ============ 渲染统计卡片 ============
function renderStats(data) {
    document.getElementById("stat-total").textContent = data.total;
    document.getElementById("stat-avg").textContent = data.avg_score;
    document.getElementById("stat-best-name").textContent = data.best_window.name;
    document.getElementById("stat-best-score").textContent = data.best_window.score;
    const bestDelta = document.getElementById("stat-best-delta");
    bestDelta.textContent = "(" + (data.score_delta_best >= 0 ? "+" : "") + data.score_delta_best + ")";

    document.getElementById("stat-worst-name").textContent = data.worst_window.name;
    document.getElementById("stat-worst-score").textContent = data.worst_window.score;
    const worstDelta = document.getElementById("stat-worst-delta");
    worstDelta.textContent = "(" + (data.score_delta_worst >= 0 ? "+" : "") + data.score_delta_worst + ")";
}


// ============ 渲染所有图表 ============
function renderCharts(data) {
    renderWindowAvg(data.window_avg);
    renderScoreDist(data.score_dist);
    renderWindowRank(data.window_rank);
    renderCuisineScore(data.cuisine_score);
    renderPriceScatter(data.price_scatter);
    renderWordCloud(data.word_cloud);
}

// 各窗口平均分柱状图
function renderWindowAvg(data) {
    const chart = charts["chart-window-avg"];
    chart.setOption({
        color: COLORS,
        tooltip: { trigger: "axis", formatter: "{b}<br/>平均分: {c}" },
        grid: { left: 80, right: 20, top: 20, bottom: 30 },
        xAxis: {
            type: "value",
            min: 2, max: 5,
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        yAxis: {
            type: "category",
            data: data.map(d => d.name).reverse(),
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        series: [{
            type: "bar",
            data: data.map(d => d.value).reverse(),
            barWidth: "55%",
            itemStyle: {
                borderRadius: [0, 6, 6, 0],
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: "#FFB347" },
                    { offset: 1, color: "#FF6B35" },
                ]),
            },
            label: {
                show: true,
                position: "right",
                formatter: "{c}",
                fontFamily: "Microsoft YaHei",
            },
        }],
        animationDuration: 800,
    }, true);
}

// 评分分布饼图
function renderScoreDist(data) {
    const chart = charts["chart-score-dist"];
    chart.setOption({
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        legend: { bottom: 0, fontFamily: "Microsoft YaHei" },
        color: ["#FF6B35", "#FFB347", "#FFD700", "#E85D75", "#6AB04C"],
        series: [{
            type: "pie",
            radius: ["45%", "70%"],
            center: ["50%", "45%"],
            avoidLabelOverlap: false,
            itemStyle: {
                borderRadius: 6,
                borderColor: "#fff",
                borderWidth: 2,
            },
            label: { fontFamily: "Microsoft YaHei" },
            data: data,
        }],
        animationDuration: 800,
    }, true);
}

// 窗口热度排行
function renderWindowRank(data) {
    const chart = charts["chart-window-rank"];
    chart.setOption({
        color: [COLORS[2]],
        tooltip: { trigger: "axis", formatter: "{b}<br/>评价数: {c}" },
        grid: { left: 110, right: 30, top: 10, bottom: 30 },
        xAxis: { type: "value", axisLabel: { fontFamily: "Microsoft YaHei" } },
        yAxis: {
            type: "category",
            data: data.map(d => d.name).reverse(),
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        series: [{
            type: "bar",
            data: data.map(d => d.value).reverse(),
            barWidth: "55%",
            itemStyle: {
                borderRadius: [0, 6, 6, 0],
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: "#FFD700" },
                    { offset: 1, color: "#FFB347" },
                ]),
            },
            label: {
                show: true,
                position: "right",
                fontFamily: "Microsoft YaHei",
            },
        }],
        animationDuration: 800,
    }, true);
}

// 菜系类型平均分
function renderCuisineScore(data) {
    const chart = charts["chart-cuisine-score"];
    chart.setOption({
        color: COLORS,
        tooltip: { trigger: "axis", formatter: "{b}<br/>平均分: {c}" },
        grid: { left: 50, right: 20, top: 30, bottom: 40 },
        xAxis: {
            type: "category",
            data: data.map(d => d.name),
            axisLabel: { fontFamily: "Microsoft YaHei", interval: 0 },
        },
        yAxis: { type: "value", min: 3, max: 5, axisLabel: { fontFamily: "Microsoft YaHei" } },
        series: [{
            type: "bar",
            data: data.map(d => d.value),
            barWidth: "50%",
            itemStyle: {
                borderRadius: [6, 6, 0, 0],
            },
            label: {
                show: true,
                position: "top",
                formatter: "{c}",
                fontFamily: "Microsoft YaHei",
            },
        }],
        animationDuration: 800,
    }, true);
}

// 价格 vs 评分散点图
function renderPriceScatter(data) {
    const chart = charts["chart-price-scatter"];
    const series = data.data.map((s, i) => ({
        name: s.name,
        type: "scatter",
        symbolSize: 12,
        data: s.data,
        color: COLORS[i % COLORS.length],
    }));

    chart.setOption({
        tooltip: {
            trigger: "item",
            formatter: (p) => `价格: ${p.value[0]}元<br/>评分: ${p.value[1]}`,
        },
        legend: { bottom: 0, fontFamily: "Microsoft YaHei" },
        grid: { left: 50, right: 20, top: 30, bottom: 50 },
        xAxis: {
            type: "value",
            name: "价格(元)",
            nameTextStyle: { fontFamily: "Microsoft YaHei" },
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        yAxis: {
            type: "value",
            name: "评分",
            min: 1, max: 5,
            nameTextStyle: { fontFamily: "Microsoft YaHei" },
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        series: series,
        animationDuration: 800,
    }, true);
}

// 词云
function renderWordCloud(data) {
    const chart = charts["chart-wordcloud"];
    if (!data || data.length === 0) {
        chart.clear();
        return;
    }

    chart.setOption({
        tooltip: { show: true, fontFamily: "Microsoft YaHei" },
        series: [{
            type: "wordCloud",
            gridSize: 8,
            sizeRange: [14, 60],
            rotationRange: [-45, 45],
            shape: "circle",
            drawOutOfBound: false,
            textStyle: {
                fontFamily: "Microsoft YaHei",
                fontWeight: "bold",
                color: () => {
                    return COLORS[Math.floor(Math.random() * COLORS.length)];
                },
            },
            emphasis: {
                textStyle: { shadowBlur: 10, shadowColor: "#333" },
            },
            data: data,
        }],
        animationDuration: 1200,
    }, true);
}


// ============ 渲染数据表格 ============
async function loadTable() {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.cuisine && state.cuisine !== "全部") params.set("cuisine", state.cuisine);
    params.set("page", state.page);
    params.set("size", state.size);

    const res = await fetch("/api/table?" + params.toString());
    const data = await res.json();

    // 更新分页信息
    document.getElementById("table-total").textContent = data.total;
    document.getElementById("current-page").textContent = data.page;
    document.getElementById("total-pages").textContent = data.pages;
    document.getElementById("prev-page").disabled = state.page <= 1;
    document.getElementById("next-page").disabled = state.page >= data.pages;

    // 填充表格
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";

    data.rows.forEach(row => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${row["窗口名"] ?? "-"}</td>
            <td>${row["菜品名"] ?? "-"}</td>
            <td>${row["菜系类型"] ?? "-"}</td>
            <td>${row["评分"] ?? "-"}</td>
            <td>${row["价格"] ?? "-"}</td>
            <td title="${row["评价文字"] ?? ""}">${row["评价文字"] ?? "-"}</td>
            <td>${row["日期"] ?? "-"}</td>
        `;
        tbody.appendChild(tr);
    });
}
