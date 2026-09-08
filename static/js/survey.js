/* =============================================
   食堂窗口问卷 - 交互逻辑
   - 动态渲染 8 个窗口卡片
   - 5 星评分交互（hover 预览 + click 选中）
   - 多选标签切换
   - 表单提交到 /api/survey/submit
   ============================================= */

// 从后端获取配置（窗口列表 + 预设标签）
let WINDOWS = [];
let POSITIVE_TAGS = [];
let NEGATIVE_TAGS = [];

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
        // 兜底：显示错误提示
        document.getElementById("window-cards").innerHTML =
            '<p style="text-align:center;color:#c62828;padding:40px;">❌ 加载失败，请刷新重试</p>';
    }
}

// ========== 渲染窗口卡片 ==========

function renderWindowCards() {
    const container = document.getElementById("window-cards");
    container.innerHTML = "";

    WINDOWS.forEach((window, idx) => {
        const card = document.createElement("div");
        card.className = "window-card";
        card.dataset.window = window.name;

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
                            <span class="star" data-score="${i}">★</span>
                        `).join("")}
                    </div>
                    <span class="rating-text" data-role="rating-text"></span>
                </div>

                <!-- 多选标签 -->
                <div class="tags-section">
                    <div class="tags-label">你觉得这家窗口怎么样？（可多选）</div>

                    <div class="tags-group tags-group--positive">
                        <div class="tags-sub-label">👍 好的方面</div>
                        <div class="tag-options" data-type="positive">
                            ${POSITIVE_TAGS.map(t =>
                                `<span class="tag-option" data-tag="${t}">${t}</span>`
                            ).join("")}
                        </div>
                    </div>

                    <div class="tags-group tags-group--negative">
                        <div class="tags-sub-label">👎 需要改进</div>
                        <div class="tag-options" data-type="negative">
                            ${NEGATIVE_TAGS.map(t =>
                                `<span class="tag-option" data-tag="${t}">${t}</span>`
                            ).join("")}
                        </div>
                    </div>
                </div>

                <!-- 自由备注 -->
                <div class="comment-row">
                    <label>💬 想说点什么？</label>
                    <textarea placeholder="（选填）随便写两句..."
                              maxlength="300"></textarea>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

// ========== 事件绑定 ==========

function bindEvents() {
    // 图片点击放大
    document.querySelectorAll(".window-card__image-wrap").forEach(wrap => {
        wrap.addEventListener("click", () => {
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
            const score = parseInt(target.dataset.score);
            previewStars(starsEl, score);
        });

        starsEl.addEventListener("mouseleave", () => {
            const windowName = starsEl.dataset.window;
            const current = surveyState[windowName].score;
            renderStars(starsEl, current);
        });

        // 点击选中
        starsEl.addEventListener("click", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            const score = parseInt(target.dataset.score);
            const windowName = starsEl.dataset.window;
            surveyState[windowName].score = score;
            renderStars(starsEl, score);
            markCardEvaluated(starsEl);
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
        ta.addEventListener("input", (e) => {
            const card = ta.closest(".window-card");
            const windowName = card.dataset.window;
            surveyState[windowName].comment = ta.value;
        });
    });

    // 重置按钮
    document.getElementById("reset-btn").addEventListener("click", resetSurvey);

    // 表单提交
    document.getElementById("survey-form").addEventListener("submit", submitSurvey);

    // 弹窗关闭
    document.getElementById("modal-close").addEventListener("click", () => {
        document.getElementById("success-modal").classList.add("hidden");
        resetSurvey();
    });
}

// ========== 辅助函数 ==========

function previewStars(starsEl, score) {
    starsEl.querySelectorAll(".star").forEach((star, i) => {
        if (i < score) {
            star.classList.add("active");
        } else {
            star.classList.remove("active");
        }
    });
}

function renderStars(starsEl, score) {
    starsEl.querySelectorAll(".star").forEach((star, i) => {
        if (i < score) {
            star.classList.add("active", "selected");
        } else {
            star.classList.remove("active", "selected");
        }
    });

    // 更新文字提示
    const card = starsEl.closest(".window-card");
    const textEl = card.querySelector('[data-role="rating-text"]');
    if (score > 0) {
        textEl.textContent = RATING_TEXTS[score - 1];
    } else {
        textEl.textContent = "";
    }
}

function markCardEvaluated(starsEl) {
    const card = starsEl.closest(".window-card");
    card.classList.add("evaluated");
}

// ========== 重置 ==========

function resetSurvey() {
    // 重置状态
    WINDOWS.forEach(w => {
        surveyState[w.name] = { score: 0, tags: [], comment: "" };
    });
    // 重新渲染
    renderWindowCards();
    bindEvents();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ========== 提交 ==========

async function submitSurvey(e) {
    e.preventDefault();

    // 验证：至少评了一个窗口
    const evaluated = Object.values(surveyState).filter(s => s.score > 0);
    if (evaluated.length === 0) {
        alert("至少给一个窗口打个分吧 ⭐");
        return;
    }

    // 只提交有评分的窗口
    const payload = evaluated.map(s => ({
        window_name: Object.keys(surveyState).find(k => surveyState[k] === s),
        satisfaction: s.score,
        tags: s.tags,
        comment: s.comment || "",
    }));

    const btn = document.getElementById("submit-btn");
    btn.disabled = true;
    btn.textContent = "提交中...";

    try {
        const resp = await fetch("/api/survey/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ responses: payload }),
        });

        const data = await resp.json();

        if (data.ok) {
            // 显示成功弹窗
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

    // 点击空白或关闭按钮都能关
    imgModalEl.addEventListener("click", (e) => {
        if (e.target === imgModalEl || e.target.classList.contains("img-modal__close")) {
            closeImageModal();
        }
    });

    // ESC 键关闭
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
    document.body.style.overflow = "hidden";  // 防止背景滚动
}

function closeImageModal() {
    if (!imgModalEl) return;
    imgModalEl.classList.add("hidden");
    document.body.style.overflow = "";
}

// ========== 启动 ==========

initSurvey();
