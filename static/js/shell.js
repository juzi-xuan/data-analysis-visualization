// ============================================================
// 学生端公共脚本：图标 / 文本工具 / 缩略图 / 窗口详情弹窗
// 被 index.html 和 windows.html 共用（普通 script，直接挂全局）
// ============================================================

// ------------------------------------------------------------
// 内联 SVG 图标
// 不用 emoji 当图标：emoji 依赖系统字体、各平台长得不一样，
// 而且没法用 CSS 控颜色和尺寸。SVG 可以 currentColor 跟随文字色。
// ------------------------------------------------------------
const ICON_STAR = `<svg class="i-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5 14.29 8.84 21.04 9.06 15.71 13.21 17.58 19.69 12 15.9 6.42 19.69 8.29 13.21 2.96 9.06 9.71 8.84Z"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5"/></svg>`;
const ICON_EMPTY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M8 14.5h8"/></svg>`;

// ------------------------------------------------------------
// 转义
// 数据里可能混入用户提交的内容（问卷允许自定义餐品名），
// 凡是插进 innerHTML 的值都必须先转义，否则会有 XSS 风险。
// ------------------------------------------------------------
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ESC_MAP[c]);
}

// 取名字的第一个字，作为没有图片时的占位字
function firstChar(s) {
    const t = String(s || "").trim();
    return esc(t.charAt(0) || "?");
}

// 根据菜名生成稳定的 HSL 颜色（不同菜品颜色不同，同一菜品颜色固定）
// 饱和度 55%、亮度 65% 保证颜色温和柔和，不刺眼
function dishColor(name) {
    let hash = 0;
    const s = String(name || "");
    for (let i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) & 0xffff;
    }
    const hue = hash % 360;
    return `hsl(${hue}, 55%, 65%)`;
}

// ------------------------------------------------------------
// 缩略图
// 原图是 200~300KB 的大图，列表里只显示 44~64px，
// 所以统一走后端自带的 /api/thumb 接口（按需生成 + 磁盘缓存）。
// 允许的宽度白名单是 200 / 300 / 400 / 600。
// ------------------------------------------------------------
function thumbURL(path, w) {
    return path ? `/api/thumb?path=${encodeURIComponent(path)}&w=${w}` : "";
}

// 有 src → 显示图片；没有 src → 颜色占位块（基于 label 哈希生成）。
// 颜色块垫在底层，图片加载成功就盖住它；
// 图片 404 时 onerror 把自己删掉，露出颜色块 —— 永远不会出现裂图图标。
function thumbHTML(src, label, cls) {
    const color = dishColor(label);
    const block = `<span style="background:${color};">${firstChar(label)}</span>`;
    const img = src
        ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">`
        : "";
    return `<span class="thumb ${cls}">${block}${img}</span>`;
}

function emptyHTML(msg) {
    return `<div class="empty">${ICON_EMPTY}<div>${msg}</div></div>`;
}

// 配置里的标签自带 emoji 前缀（如 "⭐好吃"、"🔥口味正宗"），
// 而新风格不用 emoji 当图标，所以纯文字展示时把开头的符号去掉
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+\s*/u;

function plainText(s) {
    return String(s == null ? "" : s).replace(LEADING_EMOJI, "");
}

// 评分统一保留一位小数：接口对整数分返回 4，
// 直接输出会变成 "4"，和别处的 "4.0" 不一致
function scoreText(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(1) : "";
}

// ------------------------------------------------------------
// 窗口详情弹窗
// 首页和窗口口碑页都用同一个弹窗，所以放在公共服务里。
// 页面里需要有 #window-modal / #modal-close / #modal-header / #modal-body
// ------------------------------------------------------------
function initWindowModal() {
    const modal = document.getElementById("window-modal");
    if (!modal) return;

    // 点右上角 ✕
    document.getElementById("modal-close")?.addEventListener("click", closeWindowModal);
    // 点遮罩空白处
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeWindowModal();
    });
    // 按 Esc
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeWindowModal();
    });
}

function closeWindowModal() {
    document.getElementById("window-modal")?.classList.remove("show");
}

async function openWindowDetail(windowName) {
    const modal = document.getElementById("window-modal");
    const header = document.getElementById("modal-header");
    const body = document.getElementById("modal-body");
    if (!modal) return;

    header.innerHTML = `<div class="loading-line">加载中…</div>`;
    body.innerHTML = "";
    modal.classList.add("show");

    try {
        const res = await fetch(
            `/api/recommend/window?window=${encodeURIComponent(windowName)}`
        );
        const d = await res.json();

        if (!d.ok) {
            header.innerHTML = `<div class="loading-line">${esc(d.msg || "加载失败")}</div>`;
            return;
        }

        header.innerHTML = `
            <div class="modal-window-score">${esc(scoreText(d.overall_score))}<small> / 5</small></div>
            <div class="modal-window-name">${esc(d.window)}</div>
            <div class="modal-window-meta">${esc(d.canteen)} · ${esc(d.total_count)} 条评价</div>
        `;

        let html = "";

        // ---- 各维度评分 ----
        const dims = Object.entries(d.dim_scores || {});
        if (dims.length) {
            html += `<div class="sec-label">各维度评分</div>`;
            dims.forEach(([dim, score]) => {
                const pct = Math.min(100, Math.max(0, (Number(score) / 5) * 100)).toFixed(0);
                const cls = score >= 4 ? "dim-good" : score >= 3 ? "dim-mid" : "dim-bad";
                html += `
                    <div class="dim-row">
                        <div class="dim-label">${esc(plainText(dim))}</div>
                        <div class="dim-bar-wrap">
                            <div class="dim-bar ${cls}" style="width:${pct}%"></div>
                        </div>
                        <div class="dim-score">${esc(scoreText(score))}</div>
                    </div>`;
            });
            html += `<div class="sec-gap"></div>`;
        }

        // ---- 推荐菜品 ----
        if (d.top_dishes && d.top_dishes.length) {
            html += `<div class="sec-label">推荐菜品 TOP ${d.top_dishes.length}</div>`;
            d.top_dishes.forEach((item, i) => {
                html += `
                    <div class="dish-item">
                        <div class="dish-item-name">${i + 1}. ${esc(item.name)}</div>
                        <div class="dish-item-info">
                            ${ICON_STAR}<span>${esc(scoreText(item.score))}</span>
                            <span>${esc(item.price || "")}</span>
                        </div>
                    </div>`;
            });
            html += `<div class="sec-gap"></div>`;
        }

        // ---- 同学反馈较多的问题 ----
        if (d.problems && d.problems.length) {
            html += `<div class="sec-label">同学反馈较多的问题</div>`;
            html += `<div>${d.problems
                .map((p) => `<span class="problem-tag">${esc(plainText(p))}</span>`)
                .join("")}</div>`;
            html += `<div class="sec-gap"></div>`;
        }

        // ---- 全部评价明细 ----
        if (d.all_reviews && d.all_reviews.length) {
            html += `<div class="sec-label">全部评价（${d.all_reviews.length} 条）</div>`;
            html += `<div class="review-list">`;
            d.all_reviews.forEach((r) => {
                const score = Number(r.score);
                const color = score >= 4 ? "var(--positive)"
                            : score >= 3 ? "var(--star)"
                            : "var(--danger)";
                html += `
                    <div class="review-row">
                        <div class="review-top">
                            <div class="review-dish">${esc(r.dish || "（综合）")}</div>
                            <div class="review-score" style="color:${color}">
                                ${ICON_STAR}<span>${esc(scoreText(r.score))}</span>
                                <span class="review-price">${esc(r.price || "")}</span>
                            </div>
                        </div>
                        ${r.comment ? `<div class="review-comment">${esc(plainText(r.comment))}</div>` : ""}
                        <div class="review-date">${esc(r.date)}</div>
                    </div>`;
            });
            html += `</div>`;
        }

        body.innerHTML = html;
    } catch (e) {
        header.innerHTML = `<div class="loading-line">加载失败</div>`;
    }
}
