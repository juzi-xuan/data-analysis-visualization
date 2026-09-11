// ============================================================
// 🍱 学生端新主逻辑：三模块（随机推荐 / 窗口口碑 / 条件筛选）
// + 底部迷你图表
// ============================================================

const COLORS = ["#FF6B35", "#FFB347", "#FFD700", "#E85D75", "#6AB04C", "#4A90D9", "#9B59B6", "#1ABC9C"];

// ECharts 实例
const miniCharts = {};

// 筛选状态
let filters = { min_price: null, max_price: null, cuisine: "全部", preference: "" };

// ============ 页面加载 ============
window.onload = async () => {
    initMiniCharts();
    bindEvents();
    await loadCuisineChips();
    await loadRandom();
    await loadWindowList();
    await loadMiniCharts();
};

function initMiniCharts() {
    miniCharts.scoreDist = echarts.init(document.getElementById("mini-score-dist"));
    miniCharts.cuisine = echarts.init(document.getElementById("mini-cuisine-score"));
    window.addEventListener("resize", () => Object.values(miniCharts).forEach(c => c.resize()));
}

// ============ 事件绑定 ============
function bindEvents() {
    // 换一个按钮
    document.getElementById("btn-reroll")?.addEventListener("click", loadRandom);

    // 关闭弹窗
    const modal = document.getElementById("window-modal");
    document.getElementById("modal-close")?.addEventListener("click", () => modal.classList.remove("show"));
    modal?.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("show");
    });

    // 预算 chip
    document.querySelectorAll("#price-chips .chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll("#price-chips .chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            const mn = chip.dataset.min;
            const mx = chip.dataset.max;
            filters.min_price = mn !== "" ? parseFloat(mn) : null;
            filters.max_price = mx !== "" ? parseFloat(mx) : null;
        });
    });

    // 偏好 chip
    document.querySelectorAll("#pref-chips .chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll("#pref-chips .chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            filters.preference = chip.dataset.pref || "";
        });
    });

    // 搜索按钮
    document.getElementById("btn-search")?.addEventListener("click", loadSearchResults);
}

async function loadCuisineChips() {
    const res = await fetch("/api/cuisines");
    const cuisines = await res.json();
    const container = document.getElementById("cuisine-chips");
    if (!container) return;
    container.innerHTML = "";
    cuisines.forEach((c, i) => {
        const chip = document.createElement("div");
        chip.className = "chip" + (i === 0 ? " active" : "");
        chip.textContent = c;
        chip.addEventListener("click", () => {
            container.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            filters.cuisine = c;
        });
        container.appendChild(chip);
    });
}

// ============ 模块1：随机推荐 ============
async function loadRandom() {
    const card = document.getElementById("recommend-card");
    if (!card) return;
    card.innerHTML = '<div class="recommend-emoji">🍽️</div><div style="color:#999;">正在挑选...</div>';

    try {
        const res = await fetch("/api/recommend/random");
        const data = await res.json();
        if (!data.ok) { card.innerHTML = '<div style="color:#999;">暂无数据</div>'; return; }

        const emoji = data.cuisine === "川菜" ? "🌶️" : data.cuisine === "面食" ? "🍜" : "🍚";
        card.innerHTML = `
            <div class="recommend-emoji">${emoji}</div>
            <div class="recommend-dish">${data.dish}</div>
            <div class="recommend-meta">
                <span>🏫 ${data.canteen || ""} · ${data.window}</span>
                <span>🍲 ${data.cuisine}</span>
                ${data.price ? `<span>💰 ${data.price}</span>` : ""}
            </div>
            <div class="recommend-meta">
                <span class="recommend-score">⭐ ${data.score}</span>
                <span class="recommend-recommend-pct">👍 ${data.recommend_pct}% 同学推荐</span>
            </div>
            ${data.reason ? `<div class="recommend-reason">「${data.reason}」</div>` : ""}
        `;

        // 加个小动画
        card.style.animation = "none";
        void card.offsetWidth;
        card.style.animation = "pulse 0.4s ease";
    } catch (e) {
        card.innerHTML = '<div style="color:red;">加载失败</div>';
    }
}

// ============ 模块2：窗口口碑列表 + 详情 ============
async function loadWindowList() {
    const res = await fetch("/api/charts");
    const data = await res.json();
    const windows = data.window_avg || [];

    const grid = document.getElementById("window-grid");
    if (!grid) return;
    grid.innerHTML = "";

    windows.forEach(w => {
        const card = document.createElement("div");
        card.className = "window-card";
        card.innerHTML = `
            <div class="window-card-name">${w.name}</div>
            <div class="window-card-meta">👆 点我看详情</div>
            <div class="window-card-score">${w.value} <small>/ 5.0</small></div>
        `;
        card.addEventListener("click", () => openWindowDetail(w.name));
        grid.appendChild(card);
    });
}

async function openWindowDetail(windowName) {
    const modal = document.getElementById("window-modal");
    const header = document.getElementById("modal-header");
    const body = document.getElementById("modal-body");
    if (!modal) return;

    // 先显示 loading
    header.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
    body.innerHTML = "";
    modal.classList.add("show");

    try {
        const res = await fetch(`/api/recommend/window?window=${encodeURIComponent(windowName)}`);
        const data = await res.json();
        if (!data.ok) {
            header.innerHTML = `<div style="color:red;">${data.msg || "加载失败"}</div>`;
            return;
        }

        // Header
        header.innerHTML = `
            <div class="modal-window-score">${data.overall_score}<small style="font-size:1rem;color:#ccc;"> / 5</small></div>
            <div class="modal-window-name">${data.window}</div>
            <div class="modal-window-meta">${data.canteen} · ${data.total_count} 条评价</div>
        `;

        // Body
        let html = "";

        // 维度评分条
        if (Object.keys(data.dim_scores || {}).length > 0) {
            html += `<div style="font-weight:600;margin-bottom:10px;color:#333;">🏷️ 各维度评分</div>`;
            Object.entries(data.dim_scores).forEach(([dim, score]) => {
                const pct = ((score / 5) * 100).toFixed(0);
                const cls = score >= 4 ? "dim-good" : score >= 3 ? "dim-mid" : "dim-bad";
                html += `
                    <div class="dim-row">
                        <div class="dim-label">${dim}</div>
                        <div class="dim-bar-wrap"><div class="dim-bar ${cls}" style="width:${pct}%"></div></div>
                        <div class="dim-score">${score}</div>
                    </div>
                `;
            });
            html += `<div style="height:16px;"></div>`;
        }

        // 推荐菜品
        if (data.top_dishes && data.top_dishes.length > 0) {
            html += `<div style="font-weight:600;margin-bottom:10px;color:#333;">🥇 推荐菜品 TOP ${data.top_dishes.length}</div>`;
            data.top_dishes.forEach((d, i) => {
                const rankIcon = ["🥇", "🥈", "🥉"][i] || "🍽️";
                html += `
                    <div class="dish-item">
                        <div class="dish-item-name">${rankIcon} ${d.name}</div>
                        <div class="dish-item-info">⭐${d.score} ${d.price || ""}</div>
                    </div>
                `;
            });
            html += `<div style="height:16px;"></div>`;
        }

        // 同学反馈问题
        if (data.problems && data.problems.length > 0) {
            html += `<div style="font-weight:600;margin-bottom:10px;color:#333;">⚠️ 同学反馈较多的问题</div>`;
            html += `<div>${data.problems.map(p => `<span class="problem-tag">${p}</span>`).join("")}</div>`;
            html += `<div style="height:16px;"></div>`;
        }

        // 所有评价明细
        if (data.all_reviews && data.all_reviews.length > 0) {
            html += `<div style="font-weight:600;margin-bottom:10px;color:#333;">📋 全部评价 (${data.all_reviews.length} 条)</div>`;
            html += `<div style="max-height:260px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:10px;">`;
            data.all_reviews.forEach(r => {
                const scoreColor = r.score >= 4 ? "#6AB04C" : r.score >= 3 ? "#FFB347" : "#E85D75";
                html += `
                    <div style="padding:10px 12px;border-bottom:1px solid #f5f5f5;font-size:0.85rem;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <div style="font-weight:600;color:#333;">${r.dish || "（综合）"}</div>
                            <div>
                                <span style="color:${scoreColor};font-weight:700;">⭐ ${r.score}</span>
                                <span style="color:#999;margin-left:8px;">${r.price}</span>
                            </div>
                        </div>
                        ${r.comment ? `<div style="color:#666;font-size:0.82rem;margin-bottom:4px;">${r.comment}</div>` : ""}
                        <div style="color:#bbb;font-size:0.75rem;">📅 ${r.date}</div>
                    </div>
                `;
            });
            html += `</div>`;
        }

        body.innerHTML = html;
    } catch (e) {
        header.innerHTML = `<div style="color:red;">加载失败: ${e.message}</div>`;
    }
}

// ============ 模块3：条件筛选 ============
async function loadSearchResults() {
    const list = document.getElementById("result-list");
    if (!list) return;
    list.innerHTML = '<div class="empty-state">🔍 正在搜索...</div>';

    const params = new URLSearchParams();
    if (filters.min_price != null) params.set("min_price", filters.min_price);
    if (filters.max_price != null) params.set("max_price", filters.max_price);
    if (filters.cuisine && filters.cuisine !== "全部") params.set("cuisine", filters.cuisine);
    if (filters.preference) params.set("preference", filters.preference);

    try {
        const res = await fetch("/api/recommend/search?" + params.toString());
        const data = await res.json();

        if (!data.ok || !data.items || data.items.length === 0) {
            list.innerHTML = '<div class="empty-state">😢 没找到符合条件的，试试放宽条件</div>';
            return;
        }

        list.innerHTML = "";
        data.items.forEach(item => {
            const div = document.createElement("div");
            div.className = "result-item";
            div.innerHTML = `
                <div class="result-item-main">
                    <div class="result-item-dish">${item.dish}</div>
                    <div class="result-item-window">📍 ${item.window} · ${item.cuisine} · ${item.count} 人评价</div>
                </div>
                <div class="result-item-right">
                    <div class="result-item-score">⭐ ${item.score}</div>
                    <div class="result-item-price">${item.price}</div>
                </div>
            `;
            div.addEventListener("click", () => openWindowDetail(item.window));
            list.appendChild(div);
        });
    } catch (e) {
        list.innerHTML = '<div class="empty-state">❌ 搜索失败</div>';
    }
}

// ============ 底部迷你图表 ============
async function loadMiniCharts() {
    const res = await fetch("/api/charts");
    const data = await res.json();

    if (data.score_dist && data.score_dist.length > 0) {
        miniCharts.scoreDist.setOption({
            title: { text: "评分分布", left: "center", textStyle: { fontSize: 12, fontFamily: "Microsoft YaHei" } },
            tooltip: { trigger: "item" },
            color: ["#FF6B35", "#FFB347", "#FFD700", "#E85D75", "#6AB04C"],
            series: [{
                type: "pie", radius: ["40%", "65%"], center: ["50%", "58%"],
                itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 1 },
                label: { show: false },
                data: data.score_dist,
            }],
        });
    }

    if (data.cuisine_score && data.cuisine_score.length > 0) {
        miniCharts.cuisine.setOption({
            title: { text: "菜系平均分", left: "center", textStyle: { fontSize: 12, fontFamily: "Microsoft YaHei" } },
            tooltip: { trigger: "axis" },
            grid: { left: 40, right: 10, top: 30, bottom: 30 },
            xAxis: { type: "category", data: data.cuisine_score.map(d => d.name), axisLabel: { fontSize: 10, fontFamily: "Microsoft YaHei" } },
            yAxis: { type: "value", min: 3, max: 5, axisLabel: { fontSize: 10 } },
            series: [{
                type: "bar",
                data: data.cuisine_score.map(d => d.value),
                itemStyle: {
                    borderRadius: [4, 4, 0, 0],
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: "#FF6B35" }, { offset: 1, color: "#FFB347" },
                    ]),
                },
            }],
        });
    }
}
