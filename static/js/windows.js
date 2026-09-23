// ============================================================
// 窗口口碑页逻辑
//   1) 食堂筛选标签（全部 / 一食堂 / 二食堂 …）
//   2) 窗口列表：点一行看窗口详情（弹窗）
//   3) 顶部搜索：过滤窗口列表
// 公共工具（esc / thumbHTML / openWindowDetail …）在 shell.js 里
// ============================================================

let allWindows = [];          // 窗口全量数据
let activeCanteen = "全部";   // 当前选中的食堂
let activeKeyword = "";       // 当前搜索词

window.addEventListener("DOMContentLoaded", () => {
    initWindowModal();        // shell.js：绑定 ✕ / 遮罩 / Esc 关闭
    bindEvents();
    loadWindows();
});

function bindEvents() {
    // 顶部搜索：实时过滤
    const search = document.getElementById("search-input");
    search?.addEventListener("input", () => {
        activeKeyword = search.value.trim();
        renderWindowList();
    });
}

// ============================================================
// 加载窗口列表 + 生成食堂筛选标签
// ============================================================
async function loadWindows() {
    const list = document.getElementById("win-list");
    if (!list) return;

    try {
        const res = await fetch("/api/windows");
        const data = await res.json();

        if (!data.ok || !data.items || data.items.length === 0) {
            list.innerHTML = emptyHTML("还没有窗口评价数据，去问卷页写第一条吧");
            return;
        }

        allWindows = data.items;
        renderCanteenTabs(data.canteens || ["全部"]);
        renderWindowList();
    } catch (e) {
        list.innerHTML = emptyHTML("窗口列表加载失败，请刷新重试");
    }
}

function renderCanteenTabs(canteens) {
    const box = document.getElementById("canteen-tabs");
    if (!box) return;

    box.innerHTML = canteens.map((c) => `
        <button class="tab${c === activeCanteen ? " active" : ""}" type="button"
                data-canteen="${esc(c)}">${esc(c)}</button>
    `).join("");

    box.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            activeCanteen = tab.dataset.canteen;
            box.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            renderWindowList();
        });
    });
}

// ============================================================
// 渲染窗口列表
// ============================================================
function filterWindows() {
    const q = activeKeyword.toLowerCase();
    return allWindows.filter((w) => {
        if (activeCanteen !== "全部" && w.canteen !== activeCanteen) return false;
        if (!q) return true;
        return `${w.name} ${w.canteen} ${w.cuisine || ""}`.toLowerCase().includes(q);
    });
}

function renderWindowList() {
    const list = document.getElementById("win-list");
    const countBox = document.getElementById("win-count");
    if (!list) return;

    const items = filterWindows();

    if (countBox) {
        countBox.textContent = `共 ${items.length} 个窗口`;
    }

    if (!items.length) {
        list.innerHTML = emptyHTML("没有找到符合条件的窗口，换个关键词试试");
        return;
    }

    list.innerHTML = items.map((it) => `
        <button class="win-row" type="button" data-window="${esc(it.name)}"
                aria-label="查看 ${esc(it.name)} 的口碑详情">
            ${thumbHTML(thumbURL(it.image, 200), it.name, "win-thumb")}
            <span class="win-main">
                <span class="win-name">${esc(it.name)}</span>
                <span class="win-meta">
                    ${esc(it.canteen)}${it.cuisine ? " · " + esc(it.cuisine) : ""}
                    · ${esc(it.count)} 条评价
                </span>
            </span>
            <span class="win-right">
                <span class="win-score">${ICON_STAR}${esc(scoreText(it.score))}</span>
                <span class="win-go">查看详情 ${ICON_CHEVRON}</span>
            </span>
        </button>
    `).join("");

    list.querySelectorAll(".win-row").forEach((row) => {
        row.addEventListener("click", () => openWindowDetail(row.dataset.window));
    });
}
