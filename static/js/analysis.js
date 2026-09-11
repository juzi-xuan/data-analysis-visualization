// ============================================================
// 🔬 分析师看板 - 前端逻辑
// 面向数据分析师 / 简历展示
// 包含：数据源管理 + 筛选 + 10张图表 + 洞察摘要
// ============================================================

const state = {
    search: "",
    cuisine: "全部",
    page: 1,
    size: 20,
};

const charts = {};

function closeSidebarIfMobile() {
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector(".sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");
        const menuToggle = document.getElementById("menu-toggle");
        if (sidebar) sidebar.classList.remove("open");
        if (backdrop) backdrop.classList.remove("show");
        if (menuToggle) menuToggle.textContent = "☰";
    }
}

const COLORS = ["#FF6B35", "#FFB347", "#FFD700", "#E85D75", "#6AB04C", "#4A90D9", "#9B59B6", "#1ABC9C"];


// ============ 页面加载 ============
window.onload = async () => {
    await init();
    bindEvents();
};

async function init() {
    initCharts();
    await loadCuisines();
    await loadAllData();
}

function initCharts() {
    const chartIds = [
        "chart-window-avg",
        "chart-score-dist",
        "chart-window-rank",
        "chart-cuisine-score",
        "chart-trend",
        "chart-canteen",
        "chart-price-scatter",
        "chart-sentiment",
        "chart-wordcloud",
    ];
    chartIds.forEach(id => {
        const dom = document.getElementById(id);
        if (dom) charts[id] = echarts.init(dom, null, { renderer: "canvas" });
    });

    window.addEventListener("resize", () => {
        Object.values(charts).forEach(c => c.resize());
    });
    window.addEventListener("orientationchange", () => {
        setTimeout(() => Object.values(charts).forEach(c => c.resize()), 300);
    });
}


// ============ 事件绑定 ============
function bindEvents() {
    // 数据源切换
    const sourceSelect = document.getElementById("source-select");
    if (sourceSelect) {
        sourceSelect.dataset.prev = sourceSelect.value;
        sourceSelect.addEventListener("change", async (e) => {
            closeSidebarIfMobile();
            await switchSource(e.target.value);
        });
    }

    // 搜索框
    let searchTimer = null;
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(async () => {
                state.search = e.target.value.trim();
                state.page = 1;
                await loadAllData();
            }, 300);
        });
    }

    // 文件上传
    const fileUpload = document.getElementById("file-upload");
    if (fileUpload) {
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
                    document.getElementById("data-source-badge").textContent = "📊 " + data.data_source;
                    document.getElementById("header-date").textContent = data.data_date;
                    sourceSelect.dataset.prev = data.source;
                    sourceSelect.value = data.source;
                    await loadCuisines();
                    await loadAllData();
                } else {
                    msgEl.className = "upload-msg error";
                    msgEl.textContent = "❌ " + data.msg;
                }
            } catch (err) {
                msgEl.className = "upload-msg error";
                msgEl.textContent = "❌ 上传失败: " + err.message;
            }
        });
    }

    // 重置按钮
    const resetBtn = document.getElementById("reset-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            closeSidebarIfMobile();
            const res = await fetch("/api/reset");
            await res.json();
            document.getElementById("data-source-badge").textContent = "📊 模拟数据";
            document.getElementById("upload-msg").textContent = "";
            sourceSelect.value = "mock";
            sourceSelect.dataset.prev = "mock";
            await loadCuisines();
            await loadAllData();
        });
    }

    // 下载 CSV
    const downloadBtn = document.getElementById("download-btn");
    if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
            const params = new URLSearchParams();
            if (state.search) params.set("search", state.search);
            if (state.cuisine && state.cuisine !== "全部") params.set("cuisine", state.cuisine);
            window.location.href = "/api/download?" + params.toString();
        });
    }

    // 分页
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.addEventListener("click", () => { if (state.page > 1) { state.page--; loadTable(); } });
    if (nextBtn) nextBtn.addEventListener("click", () => { state.page++; loadTable(); });

    // 移动端侧边栏
    const menuToggle = document.getElementById("menu-toggle");
    const sidebar = document.querySelector(".sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");

    function openSidebar() { if (sidebar) sidebar.classList.add("open"); if (backdrop) backdrop.classList.add("show"); if (menuToggle) menuToggle.textContent = "✕"; }
    function closeSidebar() { if (sidebar) sidebar.classList.remove("open"); if (backdrop) backdrop.classList.remove("show"); if (menuToggle) menuToggle.textContent = "☰"; }
    function toggleSidebar() { sidebar.classList.contains("open") ? closeSidebar() : openSidebar(); }

    if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);
    if (backdrop) backdrop.addEventListener("click", closeSidebar);
    window.addEventListener("resize", () => { if (window.innerWidth > 768) closeSidebar(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sidebar && sidebar.classList.contains("open")) closeSidebar(); });
}


// ============ 切换数据源 ============
async function switchSource(target) {
    const sourceSelect = document.getElementById("source-select");
    try {
        const res = await fetch("/api/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: target }),
        });
        const data = await res.json();
        if (!data.ok) {
            alert("❌ " + data.msg);
            sourceSelect.value = sourceSelect.dataset.prev || "mock";
            return;
        }

        document.getElementById("data-source-badge").textContent = "📊 " + data.data_source;
        document.getElementById("header-date").textContent = data.data_date;
        sourceSelect.dataset.prev = target;

        state.search = "";
        state.cuisine = "全部";
        state.page = 1;

        await loadCuisines();
        await loadAllData();
    } catch (err) {
        alert("切换失败: " + err.message);
    }
}


// ============ 菜系筛选 ============
async function loadCuisines() {
    const res = await fetch("/api/cuisines");
    const cuisines = await res.json();

    const container = document.getElementById("cuisine-tags");
    if (!container) return;
    container.innerHTML = "";
    cuisines.forEach(c => {
        const tag = document.createElement("div");
        tag.className = "filter-tag" + (c === state.cuisine ? " active" : "");
        tag.textContent = c;
        tag.onclick = async () => {
            closeSidebarIfMobile();
            state.cuisine = c;
            state.page = 1;
            container.querySelectorAll(".filter-tag").forEach(t => t.classList.remove("active"));
            tag.classList.add("active");
            await loadAllData();
        };
        container.appendChild(tag);
    });
}


// ============ 加载所有数据（并行请求 6 个 API） ============
async function loadAllData() {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.cuisine && state.cuisine !== "全部") params.set("cuisine", state.cuisine);

    const [chartsRes, summaryRes, trendRes, canteenRes, sentimentRes] = await Promise.all([
        fetch("/api/charts?" + params.toString()),
        fetch("/api/analysis/stats?" + params.toString()),
        fetch("/api/analysis/trend?" + params.toString()),
        fetch("/api/analysis/canteen_compare?" + params.toString()),
        fetch("/api/analysis/sentiment?" + params.toString()),
    ]);

    const chartsData = await chartsRes.json();
    const analysisStats = await summaryRes.json();
    const trendData = await trendRes.json();
    const canteenData = await canteenRes.json();
    const sentimentData = await sentimentRes.json();

    renderAnalysisStats(analysisStats);
    renderInsights(analysisStats.insights);
    renderCharts(chartsData, trendData, canteenData, sentimentData);
    await loadTable();
}


// ============ 分析师统计卡片 ============
function renderAnalysisStats(s) {
    document.getElementById("a-total").textContent = s.total;
    document.getElementById("a-window-count").textContent = s.window_count;
    document.getElementById("a-avg-score").textContent = `${s.avg_score} ± ${s.std_score}`;
    document.getElementById("a-median").textContent = s.median_score;
    document.getElementById("a-canteen").textContent = `${s.canteen_count} 个食堂`;
    document.getElementById("a-avg-price").textContent = s.avg_price;
    document.getElementById("a-range").textContent = s.date_range;
    document.getElementById("a-corr").textContent = s.correlation;
}

// ============ 洞察摘要 ============
function renderInsights(insights) {
    const list = document.getElementById("insight-list");
    if (!list) return;
    list.innerHTML = "";
    if (!insights || insights.length === 0) {
        list.innerHTML = '<li class="insight-loading">暂无足够数据生成洞察</li>';
        return;
    }
    insights.forEach(text => {
        const li = document.createElement("li");
        li.innerHTML = text;
        list.appendChild(li);
    });
}


// ============ 渲染全部图表 ============
function renderCharts(chartsData, trendData, canteenData, sentimentData) {
    // 原有 6 张
    renderWindowAvg(chartsData.window_avg);
    renderScoreDist(chartsData.score_dist);
    renderWindowRank(chartsData.window_rank);
    renderCuisineScore(chartsData.cuisine_score);
    renderPriceScatter(chartsData.price_scatter);
    renderWordCloud(chartsData.word_cloud);
    // 新增 4 张
    renderTrend(trendData);
    renderCanteenCompare(canteenData);
    renderSentiment(sentimentData);
}

// ---------- 窗口平均分 ----------
function renderWindowAvg(data) {
    const chart = charts["chart-window-avg"];
    if (!chart) return;
    chart.setOption({
        color: COLORS,
        tooltip: { trigger: "axis", formatter: "{b}<br/>平均分: {c}" },
        grid: { left: 80, right: 20, top: 20, bottom: 30 },
        xAxis: { type: "value", min: 2, max: 5, axisLabel: { fontFamily: "Microsoft YaHei" } },
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
                    { offset: 0, color: "#FFB347" }, { offset: 1, color: "#FF6B35" },
                ]),
            },
            label: { show: true, position: "right", formatter: "{c}", fontFamily: "Microsoft YaHei" },
        }],
        animationDuration: 800,
    }, true);
}

// ---------- 评分分布 ----------
function renderScoreDist(data) {
    const chart = charts["chart-score-dist"];
    if (!chart) return;
    chart.setOption({
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        legend: { bottom: 0, fontFamily: "Microsoft YaHei" },
        color: ["#FF6B35", "#FFB347", "#FFD700", "#E85D75", "#6AB04C"],
        series: [{
            type: "pie", radius: ["45%", "70%"], center: ["50%", "45%"],
            avoidLabelOverlap: false,
            itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
            label: { fontFamily: "Microsoft YaHei" },
            data: data,
        }],
        animationDuration: 800,
    }, true);
}

// ---------- 窗口热度 ----------
function renderWindowRank(data) {
    const chart = charts["chart-window-rank"];
    if (!chart) return;
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
                    { offset: 0, color: "#FFD700" }, { offset: 1, color: "#FFB347" },
                ]),
            },
            label: { show: true, position: "right", fontFamily: "Microsoft YaHei" },
        }],
        animationDuration: 800,
    }, true);
}

// ---------- 菜系评分 ----------
function renderCuisineScore(data) {
    const chart = charts["chart-cuisine-score"];
    if (!chart) return;
    chart.setOption({
        color: COLORS,
        tooltip: { trigger: "axis", formatter: "{b}<br/>平均分: {c}" },
        grid: { left: 50, right: 20, top: 30, bottom: 40 },
        xAxis: {
            type: "category", data: data.map(d => d.name),
            axisLabel: { fontFamily: "Microsoft YaHei", interval: 0 },
        },
        yAxis: { type: "value", min: 3, max: 5, axisLabel: { fontFamily: "Microsoft YaHei" } },
        series: [{
            type: "bar", data: data.map(d => d.value), barWidth: "50%",
            itemStyle: { borderRadius: [6, 6, 0, 0] },
            label: { show: true, position: "top", formatter: "{c}", fontFamily: "Microsoft YaHei" },
        }],
        animationDuration: 800,
    }, true);
}

// ---------- 价格 vs 评分散点 ----------
function renderPriceScatter(data) {
    const chart = charts["chart-price-scatter"];
    if (!chart) return;
    const series = data.data.map((s, i) => ({
        name: s.name, type: "scatter", symbolSize: 12,
        data: s.data, color: COLORS[i % COLORS.length],
    }));
    chart.setOption({
        tooltip: { trigger: "item", formatter: (p) => `价格: ${p.value[0]}元<br/>评分: ${p.value[1]}` },
        legend: { bottom: 0, fontFamily: "Microsoft YaHei" },
        grid: { left: 50, right: 20, top: 30, bottom: 50 },
        xAxis: {
            type: "value", name: "价格(元)",
            nameTextStyle: { fontFamily: "Microsoft YaHei" },
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        yAxis: {
            type: "value", name: "评分", min: 1, max: 5,
            nameTextStyle: { fontFamily: "Microsoft YaHei" },
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        series: series,
        animationDuration: 800,
    }, true);
}

// ---------- 时间趋势（新增） ----------
function renderTrend(data) {
    const chart = charts["chart-trend"];
    if (!chart) return;
    if (!data || !data.dates || data.dates.length === 0) {
        chart.clear();
        return;
    }

    chart.setOption({
        tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
        legend: { data: ["平均评分", "样本量"], fontFamily: "Microsoft YaHei" },
        grid: { left: 50, right: 60, top: 40, bottom: 40 },
        xAxis: {
            type: "category",
            data: data.dates,
            axisLabel: { fontFamily: "Microsoft YaHei", rotate: data.dates.length > 7 ? 30 : 0 },
        },
        yAxis: [
            { type: "value", name: "评分", min: 1, max: 5, nameTextStyle: { fontFamily: "Microsoft YaHei" }, axisLabel: { fontFamily: "Microsoft YaHei" } },
            { type: "value", name: "样本量", nameTextStyle: { fontFamily: "Microsoft YaHei" }, axisLabel: { fontFamily: "Microsoft YaHei" } },
        ],
        series: [
            {
                name: "平均评分", type: "line", smooth: true, data: data.avg_scores,
                itemStyle: { color: "#FF6B35" },
                lineStyle: { width: 3 },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: "rgba(255,107,53,0.3)" },
                        { offset: 1, color: "rgba(255,107,53,0.02)" },
                    ]),
                },
            },
            {
                name: "样本量", type: "bar", yAxisIndex: 1, data: data.counts,
                itemStyle: { color: "rgba(74,144,217,0.5)", borderRadius: [4, 4, 0, 0] },
            },
        ],
        animationDuration: 800,
    }, true);
}

// ---------- 食堂对比（新增） ----------
function renderCanteenCompare(data) {
    const chart = charts["chart-canteen"];
    if (!chart) return;
    if (!data || data.length === 0) {
        chart.clear();
        return;
    }

    chart.setOption({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { data: ["平均评分", "窗口数"], fontFamily: "Microsoft YaHei" },
        grid: { left: 50, right: 60, top: 40, bottom: 30 },
        xAxis: {
            type: "category",
            data: data.map(d => d.canteen),
            axisLabel: { fontFamily: "Microsoft YaHei" },
        },
        yAxis: [
            { type: "value", name: "平均评分", min: 1, max: 5, nameTextStyle: { fontFamily: "Microsoft YaHei" }, axisLabel: { fontFamily: "Microsoft YaHei" } },
            { type: "value", name: "窗口数", nameTextStyle: { fontFamily: "Microsoft YaHei" }, axisLabel: { fontFamily: "Microsoft YaHei" } },
        ],
        series: [
            {
                name: "平均评分", type: "bar",
                data: data.map(d => d.avg_score),
                barWidth: "35%",
                itemStyle: {
                    borderRadius: [6, 6, 0, 0],
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: "#667eea" }, { offset: 1, color: "#764ba2" },
                    ]),
                },
                label: { show: true, position: "top", fontFamily: "Microsoft YaHei" },
            },
            {
                name: "窗口数", type: "line", yAxisIndex: 1, data: data.map(d => d.window_count),
                itemStyle: { color: "#E85D75" }, symbolSize: 12,
                lineStyle: { width: 3 },
            },
        ],
        animationDuration: 800,
    }, true);
}

// ---------- 情感占比（新增） ----------
function renderSentiment(data) {
    const chart = charts["chart-sentiment"];
    if (!chart) return;
    if (!data || data.length === 0) {
        chart.clear();
        return;
    }

    const colors = data.map(d => d.color).filter(Boolean);
    chart.setOption({
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        legend: { bottom: 0, fontFamily: "Microsoft YaHei" },
        color: colors.length > 0 ? colors : ["#6AB04C", "#E85D75"],
        series: [{
            type: "pie", radius: ["45%", "70%"], center: ["50%", "45%"],
            avoidLabelOverlap: false,
            itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
            label: { fontFamily: "Microsoft YaHei" },
            data: data,
        }],
        animationDuration: 800,
    }, true);
}

// ---------- 词云 ----------
function renderWordCloud(data) {
    const chart = charts["chart-wordcloud"];
    if (!chart) return;
    if (!data || data.length === 0) { chart.clear(); return; }
    chart.setOption({
        tooltip: { show: true, fontFamily: "Microsoft YaHei" },
        series: [{
            type: "wordCloud", gridSize: 8, sizeRange: [14, 60], rotationRange: [-45, 45],
            shape: "circle", drawOutOfBound: false,
            textStyle: {
                fontFamily: "Microsoft YaHei", fontWeight: "bold",
                color: () => COLORS[Math.floor(Math.random() * COLORS.length)],
            },
            emphasis: { textStyle: { shadowBlur: 10, shadowColor: "#333" } },
            data: data,
        }],
        animationDuration: 1200,
    }, true);
}


// ============ 数据表格 ============
async function loadTable() {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.cuisine && state.cuisine !== "全部") params.set("cuisine", state.cuisine);
    params.set("page", state.page);
    params.set("size", state.size);

    const res = await fetch("/api/table?" + params.toString());
    const data = await res.json();

    document.getElementById("table-total").textContent = data.total;
    document.getElementById("current-page").textContent = data.page;
    document.getElementById("total-pages").textContent = data.pages;
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.disabled = state.page <= 1;
    if (nextBtn) nextBtn.disabled = state.page >= data.pages;

    const tbody = document.getElementById("table-body");
    if (!tbody) return;
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
