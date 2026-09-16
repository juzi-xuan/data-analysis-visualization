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
        container.innerHTML = currentCanteen === "其他"
            ? '<p style="text-align:center;color:#999;padding:60px;">还没有人添加过餐品哦，点上面的按钮添加第一个吧 🎉</p>'
            : '<p style="text-align:center;color:#999;padding:60px;">这个食堂暂时还没有窗口 🥲</p>';
        return;
    }

    windows.forEach((window, idx) => {
        const state = surveyState[window.name] || (surveyState[window.name] = {
            score: 0, tags: [], comment: "", dishEvaluations: [],
        });
        const card = document.createElement("div");
        card.className = "window-card" + (state.score > 0 ? " evaluated" : "");
        card.dataset.window = window.name;

        // 食堂标签
        const canteenTag = window.canteen
            ? `<span class="window-card__canteen-tag">${window.canteen}</span>`
            : "";

        // 自定义窗口的餐品名标签
        const dishBadge = window.is_custom && window.dish_name
            ? `<span class="window-card__canteen-tag" style="top:32px;background:rgba(255,107,53,0.85);">🍜 ${escapeHTML(window.dish_name)}</span>`
            : "";

        // 图片区（自定义窗口如果没有图片，就不渲染图片框）
        let imageHTML = "";
        if (window.image && window.image.length > 0) {
            // 缩略图 URL：走后端 /api/thumb 动态生成，300px 宽足够卡片展示
            // 只编码文件名部分，保留 / 分隔符，避免 %2F 被服务器/代理误判
            const encodedPath = window.image.split("/").map(encodeURIComponent).join("/");
            const thumbUrl = `/api/thumb?path=${encodedPath}&w=300`;
            imageHTML = `
                <div class="window-card__image-wrap">
                    <img class="window-card__image lazy-img"
                         data-src="${thumbUrl}"
                         alt="${window.name}"
                         data-full="${window.image}"
                         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                    <div class="window-card__emoji-fallback" style="display:none;">🍜</div>
                    <span class="window-card__image-hint">🔍 点击放大</span>
                    ${canteenTag}
                    ${dishBadge}
                </div>`;
        } else {
            // 无图片：用一个简洁的标题区替代
            imageHTML = `
                <div class="window-card__no-image-top">
                    <span class="window-card__no-image-emoji">🏪</span>
                    ${canteenTag}
                    ${dishBadge}
                </div>`;
        }

        // 菜品选择器区域（自定义窗口一般没有 CSV 菜品，跳过）
        let dishSelectorHTML = "";
        if (!window.is_custom) {
            const hasDishes = window.dishes && window.dishes.length > 0;
            dishSelectorHTML = hasDishes ? renderDishSelector(window, state) : "";
        }

        // 自定义窗口的地址展示
        const addressHTML = window.is_custom && window.address
            ? `<div class="custom-card-address">📍 ${escapeHTML(window.address)}</div>`
            : "";

        card.innerHTML = `
            ${imageHTML}

            <!-- 内容区 -->
            <div class="window-card__body">
                <!-- 标题 -->
                <div class="window-card__header">
                    <span class="window-card__name">${window.name}</span>
                    <span class="window-card__cuisine">${window.cuisine || '其他'}</span>
                </div>

                ${addressHTML}

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

    // 每次渲染完重新绑定懒加载观察器（新 DOM 需要重新 observe）
    observeLazyImages();
}

// ========== 懒加载：滚动检测 + IntersectionObserver 双保险 ==========
let _lazyObserver = null;
let _scrollBound = false;

// 核心：真正负责加载「进入视口附近」的图片
function loadImagesInViewport() {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // 提前 200px 预加载，滚动到时已经加载好
    const margin = 200;

    document.querySelectorAll("img.lazy-img[data-src]").forEach(img => {
        const rect = img.getBoundingClientRect();
        // 图片顶部进入视口下方 margin 内，且还没完全滚出视口上方
        if (rect.top < vh + margin && rect.bottom > -margin) {
            const src = img.dataset.src;
            if (src) {
                // onload 后加 loaded class（去掉 shimmer + 淡入）
                img.onload = () => img.classList.add("loaded");
                img.src = src;
                img.removeAttribute("data-src");
            }
            // 已加载则不再被 IO 跟踪
            if (_lazyObserver) _lazyObserver.unobserve(img);
        }
    });
}

function observeLazyImages() {
    // 渲染后立刻加载首屏内的图片（不依赖 IO，避免首屏空白）
    loadImagesInViewport();

    // IO 作为增强：在真实浏览器里滚动触发更精准，省去滚动监听的开销
    if ("IntersectionObserver" in window && !_lazyObserver) {
        _lazyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.dataset.src;
                    if (src) {
                        img.onload = () => img.classList.add("loaded");
                        img.src = src;
                        img.removeAttribute("data-src");
                    }
                    _lazyObserver.unobserve(img);
                }
            });
        }, {
            rootMargin: "200px",
            threshold: 0.01,
        });

        // 把当前所有未加载图片交给 IO 跟踪
        document.querySelectorAll("img.lazy-img[data-src]").forEach(img => {
            _lazyObserver.observe(img);
        });
    }

    // 滚动兜底：无论 IO 是否可用，滚动时都手动检查一次（节流）
    if (!_scrollBound) {
        let ticking = false;
        window.addEventListener("scroll", () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                loadImagesInViewport();
                ticking = false;
            });
        }, { passive: true });
        _scrollBound = true;
    }
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

// 渲染单个菜品的评价输入行（带快速标签 + 投票按钮）
function renderDishInputRow(de, price) {
    const tags = de.tags || [];
    const voted = de.voted === true;
    return `
        <div class="dish-input-row" data-dish="${escapeHTML(de.name)}">
            <div class="dish-input-row__label">
                <span>📝 ${escapeHTML(de.name)}${price ? ` (¥${price})` : ''} 的评价：</span>
                <div class="dish-input-row__actions">
                    <button type="button"
                            class="dish-vote-btn ${voted ? 'voted' : ''}"
                            title="${voted ? '已投过票了，点一下取消' : '投它一票！登上人气榜 🙌'}">
                        <span class="dish-vote-btn__icon">👍</span>
                        <span class="dish-vote-btn__text">${voted ? '已投票' : '投它一票'}</span>
                    </button>
                    <button type="button" class="dish-input-row__remove" title="取消此菜品">✕</button>
                </div>
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

            // "其他" tab 显示添加按钮
            const addBar = document.getElementById("custom-add-bar");
            if (addBar) {
                addBar.style.display = (currentCanteen === "其他") ? "block" : "none";
            }
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

    // ========== 自定义餐品弹窗交互 ==========
    bindCustomDishModal();
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

    // 星级评分 - hover 预览（只给窗口卡片里的星星绑，跳过自定义弹窗里的）
    document.querySelectorAll(".window-card .stars").forEach(starsEl => {
        starsEl.addEventListener("mouseenter", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            previewStars(starsEl, parseInt(target.dataset.score));
        });

        starsEl.addEventListener("mouseleave", () => {
            const windowName = starsEl.dataset.window;
            const state = surveyState[windowName];
            if (!state) return;
            renderStars(starsEl, state.score);
        });

        starsEl.addEventListener("click", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            const score = parseInt(target.dataset.score);
            const windowName = starsEl.dataset.window;
            const state = surveyState[windowName];
            if (!state) return;
            const currentScore = state.score;
            const newScore = (currentScore === score) ? 0 : score;
            state.score = newScore;
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
                        voted: false,
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

        // 投票按钮点击事件（toggle）
        inputsContainer.querySelectorAll(".dish-vote-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const row = btn.closest(".dish-input-row");
                const dishName = row.dataset.dish;
                const evalItem = state.dishEvaluations.find(e => e.name === dishName);
                if (!evalItem) return;

                evalItem.voted = !evalItem.voted;
                btn.classList.toggle("voted", evalItem.voted);
                const icon = btn.querySelector(".dish-vote-btn__icon");
                const text = btn.querySelector(".dish-vote-btn__text");
                if (evalItem.voted) {
                    text.textContent = "已投票";
                    btn.title = "已投过票了，点一下取消";
                } else {
                    text.textContent = "投它一票";
                    btn.title = "投它一票！登上人气榜 🙌";
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

    // 只有在窗口卡片里才更新旁边的文字提示（弹窗里的星星没有这个元素）
    const card = starsEl.closest(".window-card");
    if (!card) return;
    const textEl = card.querySelector('[data-role="rating-text"]');
    if (textEl) {
        textEl.textContent = score > 0 ? RATING_TEXTS[score - 1] : "";
    }
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
            
            // 展示多个人设卡片（最多3个）
            if (data.personas && data.personas.length > 0) {
                showPersonaCards(data.personas);
                startParticles();
            }
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

// ========== 人设卡片展示（多卡片） ==========

function showPersonaCards(personas) {
    const cardsContainer = document.getElementById("persona-cards");
    const countEl = document.getElementById("persona-count");

    // 更新命中个数
    countEl.textContent = personas.length;

    // 清空旧卡片
    cardsContainer.innerHTML = "";
    cardsContainer.classList.remove("hidden");
    // JS fallback class（给不支持 :has() 的浏览器）
    cardsContainer.classList.add(`persona-cards--count-${personas.length}`);

    // 动态生成每个卡片，带 rank 样式
    personas.forEach((p, idx) => {
        const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
        const rankClass = idx === 0 ? 'persona-card--primary' : '';

        const card = document.createElement("div");
        card.className = `persona-card persona-card--${personas.length} ${rankClass}`;
        card.style.animationDelay = `${idx * 0.15}s`;
        card.innerHTML = `
            <div class="persona-card__shine"></div>
            <img class="persona-card__image" src="${p.image}" alt="${p.name}"
                 onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22150%22><rect width=%22100%22 height=%22100%22 fill=%22%23FFE4D6%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2240%22>🏷️</text></svg>'">
            <div class="persona-card__glow"></div>
            <div class="persona-card__rank">${rankBadge}</div>
            <div class="persona-card__info">
                <div class="persona-card__name">${p.name}</div>
                <div class="persona-card__pct">
                    匹配度 ${p.pct}%
                    <div class="persona-card__bar" style="width: ${p.pct}%"></div>
                </div>
            </div>
            <div class="persona-card__desc">${p.desc.replace(/\n/g, "<br>")}</div>
        `;
        cardsContainer.appendChild(card);
    });

    // 触发重绘后加上 pop-in 动画（依次弹出）
    requestAnimationFrame(() => {
        cardsContainer.querySelectorAll(".persona-card").forEach(card => {
            card.classList.add("pop-in");
        });
    });
}

// ========== 粒子特效 ==========

let particleAnimId = null;

function startParticles() {
    const canvas = document.getElementById("particle-canvas");
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    const modal = document.getElementById("success-modal");
    const modalContent = modal.querySelector(".modal-content");
    
    // 关闭时停止旧粒子
    if (particleAnimId) {
        cancelAnimationFrame(particleAnimId);
        particleAnimId = null;
    }

    // 加一点延迟，确保 DOM 完成布局
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const rect = modalContent.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;

            // 粒子类
            class Particle {
                constructor() {
                    this.reset();
                    // 随机起始位置（从中心向外扩散）
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * Math.min(rect.width, rect.height) * 0.3 + 30;
                    this.x = canvas.width / 2 + Math.cos(angle) * dist;
                    this.y = canvas.height / 2 + Math.sin(angle) * dist;
                }
                reset() {
                    const colors = ['#FF6B35', '#FFB347', '#FFD700', '#E85D75', '#6AB04C', '#4A90D9'];
                    this.color = colors[Math.floor(Math.random() * colors.length)];
                    this.size = Math.random() * 5 + 3;
                    this.speedX = (Math.random() - 0.5) * 1.5;
                    this.speedY = (Math.random() - 0.5) * 1.5 - 0.8; // 向上漂浮
                    this.alpha = Math.random() * 0.5 + 0.5;
                    this.decay = Math.random() * 0.005 + 0.002;
                }
                update() {
                    this.x += this.speedX;
                    this.y += this.speedY;
                    this.speedY -= 0.008; // 缓慢上浮
                    this.alpha -= this.decay;
                    if (this.alpha <= 0) this.reset();
                }
                draw() {
                    ctx.save();
                    ctx.globalAlpha = this.alpha;
                    ctx.fillStyle = this.color;
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                    ctx.fill();
                    // 发光效果
                    ctx.shadowColor = this.color;
                    ctx.shadowBlur = 10;
                    ctx.fill();
                    ctx.restore();
                }
            }

            // 创建粒子数组
            const particles = [];
            const particleCount = 80;
            for (let i = 0; i < particleCount; i++) {
                particles.push(new Particle());
            }

            // 动画循环
            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                particles.forEach(p => {
                    p.update();
                    p.draw();
                });
                particleAnimId = requestAnimationFrame(animate);
            }
            animate();
        });
    });

    // 监听关闭事件，停止动画
    const stopHandler = () => {
        if (particleAnimId) {
            cancelAnimationFrame(particleAnimId);
            particleAnimId = null;
        }
        modal.classList.add("hidden");
        // 重置多卡片容器
        const cardsContainer = document.getElementById("persona-cards");
        cardsContainer.innerHTML = "";
        cardsContainer.classList.add("hidden");
        // 恢复默认文字（保持 HTML 里的结构）
        document.getElementById("persona-count").textContent = "1";
        document.getElementById("modal-close").removeEventListener("click", stopHandler);
    };

    document.getElementById("modal-close").addEventListener("click", stopHandler);
    
    // 点击遮罩也关闭
    modal.addEventListener("click", (e) => {
        if (e.target === modal) stopHandler();
    }, { once: true });
}

// ========== 自定义餐品弹窗 ==========

let customRating = 0;

function bindCustomDishModal() {
    const modal = document.getElementById("custom-dish-modal");
    const openBtn = document.getElementById("open-custom-form");
    const closeBtn = document.getElementById("custom-modal-close");
    const cancelBtn = document.getElementById("custom-cancel-btn");
    const form = document.getElementById("custom-dish-form");
    const fileInput = document.getElementById("custom-image-input");
    const preview = document.getElementById("custom-image-preview");
    const previewImg = document.getElementById("custom-preview-img");
    const removeImgBtn = document.getElementById("custom-image-remove");
    const starsEl = document.getElementById("custom-rating-stars");
    const hiddenSat = document.getElementById("custom-satisfaction");

    // 打开弹窗
    if (openBtn) {
        openBtn.addEventListener("click", () => {
            modal.classList.remove("hidden");
            document.body.style.overflow = "hidden";
        });
    }

    // 关闭弹窗
    const closeModal = () => {
        modal.classList.add("hidden");
        document.body.style.overflow = "";
        form.reset();
        customRating = 0;
        hiddenSat.value = "0";
        renderStars(starsEl, 0);
        preview.style.display = "none";
        previewImg.src = "";
    };

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeModal();
        });
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
            closeModal();
        }
    });

    // 弹窗里的星星评分（hover + click）
    if (starsEl) {
        starsEl.addEventListener("mouseenter", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            previewStars(starsEl, parseInt(target.dataset.score));
        });
        starsEl.addEventListener("mouseleave", () => {
            renderStars(starsEl, customRating);
        });
        starsEl.addEventListener("click", (e) => {
            const target = e.target.closest(".star");
            if (!target) return;
            customRating = parseInt(target.dataset.score);
            hiddenSat.value = customRating;
            renderStars(starsEl, customRating);
        });
    }

    // 图片选择 → 预览
    if (fileInput) {
        fileInput.addEventListener("change", () => {
            const file = fileInput.files && fileInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    previewImg.src = ev.target.result;
                    preview.style.display = "block";
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // 移除图片
    if (removeImgBtn) {
        removeImgBtn.addEventListener("click", () => {
            fileInput.value = "";
            previewImg.src = "";
            preview.style.display = "none";
        });
    }

    // 表单提交（multipart/form-data）
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const storeName = form.store_name.value.trim();
            const dishName = form.dish_name.value.trim();
            if (!storeName || !dishName) {
                alert("请填写店名和餐品名～");
                return;
            }

            const submitBtn = document.getElementById("custom-submit-btn");
            submitBtn.disabled = true;
            submitBtn.textContent = "发布中...";

            try {
                const fd = new FormData(form);
                // 把 hidden satisfaction value 写上（因为星星组件不自动更新 input value）
                fd.set("satisfaction", customRating);

                const resp = await fetch("/api/survey/custom_dish", {
                    method: "POST",
                    body: fd,
                });

                const data = await resp.json();

                if (data.ok) {
                    alert(data.msg);
                    closeModal();

                    // 重新拉取窗口列表 + 重新渲染卡片
                    await refreshSurveyWindows();

                    // 成功后自动切到"其他" tab（如果还没切过去）
                    if (currentCanteen !== "其他") {
                        document.querySelector('.canteen-tab[data-canteen="其他"]').click();
                    }
                } else {
                    alert(data.msg || "发布失败，请稍后重试");
                }
            } catch (err) {
                console.error(err);
                alert("网络错误，请检查连接后重试");
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = "📣 发布";
            }
        });
    }
}

// 重新拉取窗口列表并重新渲染（发布新餐品后调用）
async function refreshSurveyWindows() {
    try {
        const resp = await fetch("/api/survey/windows");
        const data = await resp.json();
        WINDOWS = data.windows;
        POSITIVE_TAGS = data.positive_tags;
        NEGATIVE_TAGS = data.negative_tags;
        DISH_TAGS_POSITIVE = data.dish_tags_positive || [];
        DISH_TAGS_NEGATIVE = data.dish_tags_negative || [];

        // 为新窗口初始化状态（如果还没有的话）
        WINDOWS.forEach(w => {
            if (!surveyState[w.name]) {
                surveyState[w.name] = {
                    score: 0, tags: [], comment: "", dishEvaluations: [],
                };
            }
        });

        renderWindowCards();
        bindCardEvents();
    } catch (err) {
        console.error("刷新窗口列表失败:", err);
    }
}

// ========== 启动 ==========

initSurvey();
