/* =============================================
   食堂窗口问卷 - 交互逻辑
   - 动态渲染窗口卡片（按食堂分类过滤）
   - 5 星评分交互（hover 预览 + click 选中）
   - 多选标签切换
   - 表单提交到 /api/survey/submit
   ============================================= */

// 从后端获取配置（窗口列表 + 预设标签）
let WINDOWS = [];
let POSITIVE_TAGS = [];
let NEGATIVE_TAGS = [];

// 当前选中的食堂过滤："all" | "一食堂" | "二食堂"
let currentCanteen = "all";

// 每个窗口的状态 { windowName: { score, tags[], comment } }
let surveyState = {};

const RATING_TEXTS = ["一般", "还行", "不错", "挺好吃", "超好吃"];

// ========== 初始化 ==========

async function initSurvey() {
    try {
        const resp = await fetch("/api/survey/windows");
        const data = await resp.json();
        WINDOWS = data.windows;
        POSITIVE_TAGS = data.positive_tags;
        NEGATIVE_TAGS = data.negative_tags;

        // 初始化状态
        WINDOWS.forEach(w => {
            surveyState[w.name] = {
                score: 0,
                tags: [],
                comment: "",
            };
        });

        renderWindowCards();
        bindEvents();
    } catch (err) {
        console.error("加载窗口配置失败:", err);
        document.getElementById("window-cards").innerHTML =
            '<p style="text-align:center;color:#c62828;padding:40px;">❌ 加载失败，请刷新重试</p>';
    }
}

// ========== 渲染窗口卡片（按食堂过滤） ==========

function getFilteredWindows() {
    if (currentCanteen === "all") return WINDOWS;
    return WINDOWS.filter(w => w.canteen === currentCanteen);
}

function renderWindowCards() {
    const container = document.getElementById("window-cards");
    container.innerHTML = "";

    const windows = getFilteredWindows();

    if (windows.length === 0) {
        container.innerHTML =
            '<p style="text-align:center;color:#999;padding:60px;">这个食堂暂时还没有窗口 🥲</p>';
        return;
    }

    windows.forEach((window, idx) => {
        const state = surveyState[window.name];
        const card = document.createElement("div");
        card.className = "window-card" + (state.score > 0 ? " evaluated" : "");
        card.dataset.window = window.name;

        // 食堂标签（一食堂/二食堂）
        const canteenTag = window.canteen
            ? `<span class="window-card__canteen-tag">${window.canteen}</span>`
            : "";

        card.innerHTML = `
            <!-- 图片区 -->
            <div class="window-card__image-wrap">
                <img class="window-card__image"
                     src="${window.image}"
                     alt="${window.name}"
                     data-full="${window.image}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div class="window-card__emoji-fallback" style="display:none;">🍜</div>
                <span class="window-card__image-hint">🔍 点击放大</span>
                ${canteenTag}
            </div>

            <!-- 内容区 -->
            <div class="window-card__body">
                <!-- 标题 -->
                <div class="window-card__header">
                    <span class="window-card__name">${window.name}</span>
                    <span class="window-card__cuisine">${window.cuisine}</span>
                </div>

                <!-- 星级评分 -->
                <div class="rating-row">
                    <span class="rating-label">满意度：</span>
                    <div class="stars" data-window="${window.name}">
                        ${[1,2,3,4,5].map(i => `
                            <span class="star ${i <= state.score ? 'active selected' : ''}" data-score="${i}">★</span>
                        `).join("")}
                    </div>
                    <span class="rating-text" data-role="rating-text">${state.score > 0 ? RATING_TEXTS[state.score - 1] : ''}</span>
                </div>

                <!-- 多选标签 -->
                <div class="tags-section">
                    <div class="tags-label">你觉得这家窗口怎么样？（可多选）</div>

                    <div class="tags-group tags-group--positive">
                        <div class="tags-sub-label">👍 好的方面</div>
                        <div class="tag-options" data-type="positive">
                            ${POSITIVE_TAGS.map(t =>
                                `<span class="tag-option ${state.tags.includes(t) ? 'selected' : ''}" data-tag="${t}">${t}</span>`
                            ).join("")}
                        </div>
                    </div>

                    <div class="tags-group tags-group--negative">
                        <div class="tags-sub-label">👎 需要改进</div>
                        <div class="tag-options" data-type="negative">
                            ${NEGATIVE_TAGS.map(t =>
                                `<span class="tag-option ${state.tags.includes(t) ? 'selected' : ''}" data-tag="${t}">${t}</span>`
                            ).join("")}
                        </div>
                    </div>
                </div>

                <!-- 自由备注 -->
                <div class="comment-row">
                    <label>💬 想说点什么？</label>
                    <textarea placeholder="（选填）随便写两句..."
                              maxlength="300">${state.comment || ''}</textarea>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

// ========== 事件绑定 ==========

function bindEvents() {
    // 食堂分类切换 tab
    document.querySelectorAll(".canteen-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".canteen-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentCanteen = tab.dataset.canteen;
            renderWindowCards();
            bindCardEvents();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    });

    bindCardEvents();

    // 重置按钮
    document.getElementById("reset-btn").addEventListener("click", resetSurvey);

    // 表单提交
    document.getElementById("survey-form").addEventListener("submit", submitSurvey);

    // "继续评价"按钮：只关闭弹窗，保留已填数据
    document.getElementById("modal-close").addEventListener("click", () => {
        document.getElementById("success-modal").classList.add("hidden");
    });
}

// 卡片内部事件（每次 render 后重新绑定）
function bindCardEvents() {
    // 图片点击放大
    document.querySelectorAll(".window-card__image-wrap").forEach(wrap => {
        wrap.addEventListener("click", (e) => {
            // 点到食堂标签或按钮时不触发
            if (e.target.closest(".window-card__canteen-tag")) return;
            const img = wrap.querySelector(".window-card__image");
            if (!img || img.style.display === "none") return;
            openImageModal(img.dataset.full, img.alt);
        });
    });

    // 星级评分 - hover 预览
    document.querySelectorAll(".stars").forEach(starsEl => {
        starsEl.addEventListener("mouseenter", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            previewStars(starsEl, parseInt(target.dataset.score));
        });

        starsEl.addEventListener("mouseleave", () => {
            const windowName = starsEl.dataset.window;
            const current = surveyState[windowName].score;
            renderStars(starsEl, current);
        });

        // 点击选中 / 再次点击取消
        starsEl.addEventListener("click", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            const score = parseInt(target.dataset.score);
            const windowName = starsEl.dataset.window;
            const currentScore = surveyState[windowName].score;
            // 点击同一个分数 → 取消（设为 0），否则 → 设为该分数
            const newScore = (currentScore === score) ? 0 : score;
            surveyState[windowName].score = newScore;
            renderStars(starsEl, newScore);
            const card = starsEl.closest(".window-card");
            if (newScore > 0) {
                card.classList.add("evaluated");
            } else {
                card.classList.remove("evaluated");
            }
        });
    });

    // 多选标签点击切换
    document.querySelectorAll(".tag-option").forEach(tagEl => {
        tagEl.addEventListener("click", () => {
            const card = tagEl.closest(".window-card");
            const windowName = card.dataset.window;
            const tag = tagEl.dataset.tag;

            const tags = surveyState[windowName].tags;
            const idx = tags.indexOf(tag);
            if (idx > -1) {
                tags.splice(idx, 1);
                tagEl.classList.remove("selected");
            } else {
                tags.push(tag);
                tagEl.classList.add("selected");
            }
        });
    });

    // 文本域输入
    document.querySelectorAll(".comment-row textarea").forEach(ta => {
        ta.addEventListener("input", () => {
            const card = ta.closest(".window-card");
            const windowName = card.dataset.window;
            surveyState[windowName].comment = ta.value;
        });
    });
}

// ========== 辅助函数 ==========

function previewStars(starsEl, score) {
    starsEl.querySelectorAll(".star").forEach((star, i) => {
        star.classList.toggle("active", i < score);
    });
}

function renderStars(starsEl, score) {
    starsEl.querySelectorAll(".star").forEach((star, i) => {
        const isActive = i < score;
        star.classList.toggle("active", isActive);
        star.classList.toggle("selected", isActive);
    });

    const card = starsEl.closest(".window-card");
    const textEl = card.querySelector('[data-role="rating-text"]');
    textEl.textContent = score > 0 ? RATING_TEXTS[score - 1] : "";
}

// ========== 重置 ==========

function resetSurvey() {
    WINDOWS.forEach(w => {
        surveyState[w.name] = { score: 0, tags: [], comment: "" };
    });
    renderWindowCards();
    bindCardEvents();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ========== 提交 ==========

async function submitSurvey(e) {
    e.preventDefault();

    // 收集所有被评价的窗口（score > 0）
    const evaluated = [];
    Object.entries(surveyState).forEach(([name, state]) => {
        if (state.score > 0) {
            evaluated.push({
                window_name: name,
                satisfaction: state.score,
                tags: state.tags,
                comment: state.comment || "",
            });
        }
    });

    // 没有评价任何窗口 → 提示而不是报错
    if (evaluated.length === 0) {
        alert("你还没评价任何窗口哦，吃过哪个就给它打个分吧 😋\n（不想评价也没关系，直接关掉页面就行～）");
        return;
    }

    const btn = document.getElementById("submit-btn");
    btn.disabled = true;
    btn.textContent = "提交中...";

    try {
        const resp = await fetch("/api/survey/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ responses: evaluated }),
        });

        const data = await resp.json();

        if (data.ok) {
            document.getElementById("success-modal").classList.remove("hidden");
        } else {
            alert("提交失败：" + (data.msg || "请稍后重试"));
        }
    } catch (err) {
        console.error(err);
        alert("网络错误，请检查连接后重试");
    } finally {
        btn.disabled = false;
        btn.textContent = "📨 提交评价";
    }
}

// ========== 图片放大 Modal ==========

let imgModalEl = null;

function ensureImageModal() {
    if (imgModalEl) return;
    imgModalEl = document.createElement("div");
    imgModalEl.className = "img-modal hidden";
    imgModalEl.innerHTML = `
        <span class="img-modal__close">✕</span>
        <img alt="放大图片">
        <div class="img-modal__caption"></div>
    `;
    document.body.appendChild(imgModalEl);

    imgModalEl.addEventListener("click", (e) => {
        if (e.target === imgModalEl || e.target.classList.contains("img-modal__close")) {
            closeImageModal();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !imgModalEl.classList.contains("hidden")) {
            closeImageModal();
        }
    });
}

function openImageModal(src, caption) {
    ensureImageModal();
    const img = imgModalEl.querySelector("img");
    const cap = imgModalEl.querySelector(".img-modal__caption");
    img.src = src;
    cap.textContent = caption || "";
    imgModalEl.classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeImageModal() {
    if (!imgModalEl) return;
    imgModalEl.classList.add("hidden");
    document.body.style.overflow = "";
}

// ========== 启动 ==========

initSurvey();
