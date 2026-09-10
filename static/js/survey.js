/* =============================================
   食堂窗口问卷 - 交互逻辑（含菜品选择器）
   - 动态渲染窗口卡片（按食堂分类过滤）
   - 5 星评分交互（hover 预览 + click 选中）
   - 多选标签切换
   - 菜品选择器（可搜索多选）+ 动态描述输入框
   - 表单提交到 /api/survey/submit
   ============================================= */

// 从后端获取配置（窗口列表 + 预设标签）
let WINDOWS = [];
let POSITIVE_TAGS = [];
let NEGATIVE_TAGS = [];
let DISH_TAGS_POSITIVE = [];
let DISH_TAGS_NEGATIVE = [];

// 当前选中的食堂过滤："all" | "一食堂" | "二食堂"
let currentCanteen = "all";

// 每个窗口的状态
// { score, tags[], comment, dishEvaluations: [{name, price, description}] }
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
        DISH_TAGS_POSITIVE = data.dish_tags_positive || [];
        DISH_TAGS_NEGATIVE = data.dish_tags_negative || [];

        // 初始化状态
        WINDOWS.forEach(w => {
            surveyState[w.name] = {
                score: 0,
                tags: [],
                comment: "",
                dishEvaluations: [],
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

// ========== 渲染窗口卡片 ==========

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

        // 菜品选择器区域（只有配了 dishes 才渲染）
        const hasDishes = window.dishes && window.dishes.length > 0;
        const dishSelectorHTML = hasDishes ? renderDishSelector(window, state) : "";

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

                <!-- 菜品选择器（可选区域） -->
                ${dishSelectorHTML}

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

// 渲染菜品选择器 HTML（折叠状态初始关闭）
function renderDishSelector(window, state) {
    const dishCount = window.dishes.length;
    const selectedCount = state.dishEvaluations.length;

    return `
        <div class="dish-selector" data-role="dish-selector">
            <button type="button" class="dish-toggle">
                <span>🍽️ 选择餐品</span>
                <span class="dish-toggle__count" data-role="dish-toggle-count">
                    ${selectedCount > 0 ? `${selectedCount}/${dishCount} 已选` : `${dishCount} 道菜可评`}
                </span>
                <span class="dish-toggle__arrow">▼</span>
            </button>

            <div class="dish-panel hidden" data-role="dish-panel">
                <!-- 搜索框 -->
                <div class="dish-search-wrap">
                    <span class="dish-search__icon">🔍</span>
                    <input type="text" class="dish-search" placeholder="搜索菜品..." data-role="dish-search">
                </div>

                <!-- 菜品列表（可滚动） -->
                <div class="dish-list" data-role="dish-list">
                    ${window.dishes.map(d => {
                        const selected = state.dishEvaluations.some(e => e.name === d.name);
                        return `
                            <label class="dish-item ${selected ? 'selected' : ''}" data-dish="${escapeHTML(d.name)}">
                                <input type="checkbox" ${selected ? 'checked' : ''}>
                                <span class="dish-item__name">${escapeHTML(d.name)}</span>
                                <span class="dish-item__price">¥${d.price}</span>
                            </label>
                        `;
                    }).join("")}
                </div>

                ${dishCount > 50 ? `<div class="dish-hint">共 ${dishCount} 道菜品，可搜索过滤</div>` : ""}
            </div>

            <!-- 已选菜品的动态描述输入框 -->
            <div class="dish-inputs" data-role="dish-inputs">
                ${state.dishEvaluations.map(de => {
                    const price = (window.dishes.find(d => d.name === de.name) || {}).price;
                    return renderDishInputRow(de, price);
                }).join("")}
            </div>
        </div>
    `;
}

function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// 渲染单个菜品的评价输入行（带快速标签）
function renderDishInputRow(de, price) {
    const tags = de.tags || [];
    return `
        <div class="dish-input-row" data-dish="${escapeHTML(de.name)}">
            <div class="dish-input-row__label">
                <span>📝 ${escapeHTML(de.name)}${price ? ` (¥${price})` : ''} 的评价：</span>
                <button type="button" class="dish-input-row__remove" title="取消此菜品">✕</button>
            </div>

            <!-- 快速标签区 -->
            <div class="dish-tags-row">
                <div class="dish-tags-group">
                    ${DISH_TAGS_POSITIVE.map(t =>
                        `<span class="dish-tag dish-tag--pos ${tags.includes(t) ? 'selected' : ''}" data-dish-tag="${t}">${t}</span>`
                    ).join("")}
                </div>
                <div class="dish-tags-group">
                    ${DISH_TAGS_NEGATIVE.map(t =>
                        `<span class="dish-tag dish-tag--neg ${tags.includes(t) ? 'selected' : ''}" data-dish-tag="${t}">${t}</span>`
                    ).join("")}
                </div>
            </div>

            <textarea placeholder="（选填）这道菜怎么样？也可以点上面的标签～" maxlength="300">${escapeHTML(de.description || '')}</textarea>
        </div>
    `;
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

        starsEl.addEventListener("click", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            const score = parseInt(target.dataset.score);
            const windowName = starsEl.dataset.window;
            const currentScore = surveyState[windowName].score;
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

    // 文本域输入（窗口级 comment）
    document.querySelectorAll(".comment-row textarea").forEach(ta => {
        ta.addEventListener("input", () => {
            const card = ta.closest(".window-card");
            const windowName = card.dataset.window;
            surveyState[windowName].comment = ta.value;
        });
    });

    // ========== 菜品选择器事件 ==========

    // 折叠按钮
    document.querySelectorAll(".dish-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
            const panel = btn.parentElement.querySelector('[data-role="dish-panel"]');
            panel.classList.toggle("hidden");
            const arrow = btn.querySelector(".dish-toggle__arrow");
            if (panel.classList.contains("hidden")) {
                arrow.textContent = "▼";
            } else {
                arrow.textContent = "▲";
            }
        });
    });

    // 搜索框输入 → 过滤菜品列表
    document.querySelectorAll(".dish-search").forEach(input => {
        input.addEventListener("input", () => {
            const keyword = input.value.trim().toLowerCase();
            const list = input.closest(".dish-panel").querySelector('[data-role="dish-list"]');
            list.querySelectorAll(".dish-item").forEach(item => {
                const name = item.dataset.dish.toLowerCase();
                if (!keyword || name.includes(keyword)) {
                    item.style.display = "";
                } else {
                    item.style.display = "none";
                }
            });
        });
    });

    // 菜品 checkbox 切换
    document.querySelectorAll(".dish-item input[type='checkbox']").forEach(cb => {
        cb.addEventListener("change", () => {
            const item = cb.closest(".dish-item");
            const card = cb.closest(".window-card");
            const windowName = card.dataset.window;
            const dishName = item.dataset.dish;
            const dishes = WINDOWS.find(w => w.name === windowName).dishes;
            const dishInfo = dishes.find(d => d.name === dishName);
            const state = surveyState[windowName];

            if (cb.checked) {
                // 加入选中列表
                if (!state.dishEvaluations.some(e => e.name === dishName)) {
                    state.dishEvaluations.push({
                        name: dishName,
                        price: dishInfo ? dishInfo.price : 0,
                        description: "",
                        tags: [],
                    });
                }
                item.classList.add("selected");
            } else {
                // 移除
                state.dishEvaluations = state.dishEvaluations.filter(e => e.name !== dishName);
                item.classList.remove("selected");
            }

            updateDishInputsAndCount(card, windowName);
        });
    });

    // 已选菜品描述 textarea 输入（用事件委托，因为是动态生成的）
    // 放在下面的 bindCardEvents 末尾统一处理

    // 取消已选菜品的 ✕ 按钮
    document.querySelectorAll(".dish-input-row__remove").forEach(btn => {
        btn.addEventListener("click", () => {
            const row = btn.closest(".dish-input-row");
            const dishName = row.dataset.dish;
            const card = row.closest(".window-card");
            const windowName = card.dataset.window;
            const state = surveyState[windowName];

            // 从 state 里移除
            state.dishEvaluations = state.dishEvaluations.filter(e => e.name !== dishName);

            // 取消对应的 checkbox
            const checkbox = card.querySelector(`.dish-item[data-dish="${CSS.escape(dishName)}"] input[type='checkbox']`);
            if (checkbox) {
                checkbox.checked = false;
                checkbox.closest(".dish-item").classList.remove("selected");
            }

            // 更新 UI
            updateDishInputsAndCount(card, windowName);
        });
    });

    // 动态 textarea input 事件（事件委托）
    document.querySelectorAll(".dish-input-row textarea").forEach(ta => {
        ta.addEventListener("input", () => {
            const row = ta.closest(".dish-input-row");
            const dishName = row.dataset.dish;
            const card = ta.closest(".window-card");
            const windowName = card.dataset.window;
            const state = surveyState[windowName];
            const evalItem = state.dishEvaluations.find(e => e.name === dishName);
            if (evalItem) {
                evalItem.description = ta.value;
            }
        });
    });
}

// 更新已选菜品描述输入框区域和计数
function updateDishInputsAndCount(card, windowName) {
    const state = surveyState[windowName];
    const window = WINDOWS.find(w => w.name === windowName);
    const selector = card.querySelector('[data-role="dish-selector"]');
    if (!selector) return;

    // 更新计数
    const countEl = selector.querySelector('[data-role="dish-toggle-count"]');
    const totalDishes = window.dishes ? window.dishes.length : 0;
    const selectedCount = state.dishEvaluations.length;
    if (countEl) {
        countEl.textContent = selectedCount > 0
            ? `${selectedCount}/${totalDishes} 已选`
            : `${totalDishes} 道菜可评`;
    }

    // 重新渲染动态输入框（简单粗暴但可靠）
    const inputsContainer = selector.querySelector('[data-role="dish-inputs"]');
    if (inputsContainer) {
        inputsContainer.innerHTML = state.dishEvaluations.map(de => {
            const price = (window.dishes.find(d => d.name === de.name) || {}).price;
            return renderDishInputRow(de, price);
        }).join("");

        // 给新生成的 textarea、remove 按钮、标签 重新绑事件
        inputsContainer.querySelectorAll("textarea").forEach(ta => {
            ta.addEventListener("input", () => {
                const row = ta.closest(".dish-input-row");
                const dishName = row.dataset.dish;
                const evalItem = state.dishEvaluations.find(e => e.name === dishName);
                if (evalItem) evalItem.description = ta.value;
            });
        });

        inputsContainer.querySelectorAll(".dish-input-row__remove").forEach(btn => {
            btn.addEventListener("click", () => {
                const row = btn.closest(".dish-input-row");
                const dishName = row.dataset.dish;
                state.dishEvaluations = state.dishEvaluations.filter(e => e.name !== dishName);

                const checkbox = card.querySelector(`.dish-item[data-dish="${CSS.escape(dishName)}"] input[type='checkbox']`);
                if (checkbox) {
                    checkbox.checked = false;
                    checkbox.closest(".dish-item").classList.remove("selected");
                }

                updateDishInputsAndCount(card, windowName);
            });
        });

        // 菜品标签点击事件
        inputsContainer.querySelectorAll(".dish-tag").forEach(tagEl => {
            tagEl.addEventListener("click", () => {
                const row = tagEl.closest(".dish-input-row");
                const dishName = row.dataset.dish;
                const evalItem = state.dishEvaluations.find(e => e.name === dishName);
                if (!evalItem) return;

                const tag = tagEl.dataset.dishTag;
                const idx = evalItem.tags.indexOf(tag);
                if (idx > -1) {
                    evalItem.tags.splice(idx, 1);
                    tagEl.classList.remove("selected");
                } else {
                    evalItem.tags.push(tag);
                    tagEl.classList.add("selected");
                }
            });
        });
    }
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
        surveyState[w.name] = {
            score: 0,
            tags: [],
            comment: "",
            dishEvaluations: [],
        };
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
                dish_evaluations: state.dishEvaluations || [],
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
