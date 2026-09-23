// ============================================================
// 首页逻辑
//   1) Hero 随机推荐（一次只推一个餐食）
//   2) 人气榜（纯展示的排行榜，不带跳转 —— 窗口详情看「窗口口碑」页）
//   3) 顶部搜索：过滤人气榜
// 公共工具（esc / thumbHTML / scoreText …）在 shell.js 里
// ============================================================

let allRankItems = [];   // 人气榜全量数据；搜索时在它上面过滤，保留真实名次

window.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadRandom();
    loadPopularity();
});

function bindEvents() {
    // 「随机推荐」按钮：换一个
    document.getElementById("btn-reroll")?.addEventListener("click", loadRandom);

    // 顶部搜索：实时过滤人气榜
    const search = document.getElementById("search-input");
    search?.addEventListener("input", () => {
        renderRankList(filterRank(search.value), search.value.trim());
    });
}

// ============================================================
// 模块 1：Hero 随机推荐（只推一个餐食）
// ============================================================
async function loadRandom() {
    const card = document.getElementById("recommend-card");
    if (!card) return;
    card.innerHTML = `<div class="loading-line">正在挑选…</div>`;

    try {
        const res = await fetch("/api/recommend/random");
        const d = await res.json();

        if (!d.ok) {
            card.innerHTML = `<div class="loading-line">暂无数据</div>`;
            return;
        }

        // 标签：价格 + 菜系
        const tags = [];
        if (d.price) tags.push(`<span class="tag tag-price">${esc(d.price)}</span>`);
        if (d.cuisine) tags.push(`<span class="tag">${esc(d.cuisine)}</span>`);

        const windowLine = [d.canteen, d.window].filter(Boolean).join(" · ");

        card.innerHTML = `
            <div class="pick-head">
                ${thumbHTML(thumbURL(d.dish_image, 200), d.dish, "pick-thumb")}
                <div class="pick-info">
                    <div class="pick-name" title="${esc(d.dish)}">${esc(d.dish)}</div>
                    <div class="pick-rating">
                        ${ICON_STAR}<b>${esc(scoreText(d.score))}</b>
                        <span>· ${esc(d.recommend_pct)}% 同学推荐</span>
                    </div>
                </div>
            </div>
            ${tags.length ? `<div class="pick-tags">${tags.join("")}</div>` : ""}
            ${d.reason ? `<div class="pick-reason">「${esc(plainText(d.reason))}」</div>` : ""}
            ${windowLine ? `<div class="pick-window" title="${esc(windowLine)}">${esc(windowLine)}</div>` : ""}
        `;
    } catch (e) {
        card.innerHTML = `<div class="loading-line">加载失败</div>`;
    }
}

// ============================================================
// 模块 2：人气榜
// ============================================================
async function loadPopularity() {
    const list = document.getElementById("rank-list");
    if (!list) return;

    try {
        const res = await fetch("/api/popularity?top_n=10");
        const data = await res.json();

        if (!data.ok || !data.items || data.items.length === 0) {
            list.innerHTML = emptyHTML(
                `还没有投票数据，去 <a href="/survey">问卷页</a> 给喜欢的菜投一票吧`
            );
            return;
        }

        allRankItems = data.items;
        renderRankList(allRankItems, "");
    } catch (e) {
        list.innerHTML = emptyHTML("人气榜加载失败，请刷新重试");
    }
}

// 按关键词过滤：菜名 / 窗口名 / 菜系 任一命中即可
function filterRank(kw) {
    const q = String(kw || "").trim().toLowerCase();
    if (!q) return allRankItems;
    return allRankItems.filter((it) =>
        `${it.dish} ${it.window} ${it.cuisine || ""}`.toLowerCase().includes(q)
    );
}

// 渲染排行榜
// 名次用后端返回的 it.rank，而不是数组下标 ——
// 搜索过滤后名次要保留真实排名（比如筛出第 4、第 7 名）
function renderRankList(items, kw) {
    const list = document.getElementById("rank-list");
    if (!list) return;

    if (!items.length) {
        list.innerHTML = emptyHTML(
            kw ? `没有找到和「${esc(kw)}」相关的菜品` : "暂无数据"
        );
        return;
    }

    list.innerHTML = items.map((it) => `
        <div class="rank-row">
            <span class="rank-no n${esc(it.rank)}">${esc(it.rank)}</span>
            ${thumbHTML(thumbURL(it.dish_image, 200), it.dish, "rank-thumb")}
            <span class="rank-main">
                <span class="rank-name">${esc(it.dish)}</span>
                <span class="rank-meta">
                    ${ICON_STAR}<b>${esc(scoreText(it.avg_score))}</b>
                    <span>· ${esc(it.window)}${it.cuisine ? " · " + esc(it.cuisine) : ""}</span>
                </span>
            </span>
            <span class="rank-votes num"><b>${esc(it.votes)}</b> 票</span>
        </div>
    `).join("");
}
