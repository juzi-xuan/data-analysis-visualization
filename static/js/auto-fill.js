/* =============================================
   🤖 自动填评价演示脚本 v2
   - 模拟真实学生：交互式地逐个窗口填完整问卷
   - 视觉化：点星星、点标签、勾菜品、投票、写评论（全是真 DOM 操作）
   - 所有窗口填完才一次性提交 → 出人设卡片 → 下一个学生
   - 浮动控制面板（开始/暂停/停止/速度/人数）
   ============================================= */

(function () {
    "use strict";

    // ---------- 控制面板状态 ----------
    let isRunning = false;
    let isPaused = false;
    let stopRequested = false;
    let speedFactor = 1;
    let targetStudents = 3; // 默认模拟 3 个学生

    const COMMENTS = [
        "还行，下次可能再来",
        "味道不错，就是等了好久",
        "分量足，价格也合理",
        "有点油，不过整体可以",
        "性价比一般般",
        "环境挺好的，推荐",
        "食材新鲜，口感不错",
        "需要改进一下口味",
        "早餐经常来吃，挺稳定的",
        "偶尔换个口味试试",
        "第一次吃，感觉挺新鲜",
        "老板态度很好",
        "可以试试",
        "", "", "",
    ];

    // ---------- 随机工具 ----------

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function pickRandom(arr, min, max) {
        if (!arr || arr.length === 0) return [];
        const count = Math.min(
            Math.floor(Math.random() * (max - min + 1)) + min,
            arr.length
        );
        const shuffled = [...arr].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    /**
     * 给每个窗口的菜品分配人气权重（制造"网红菜"效应）
     * 少数菜会特别热门，被多个学生反复选中+投票
     * 结果直接写入 WINDOWS[i].dishes[j].popularity （0.3 ~ 1.0）
     */
    function assignDishPopularity() {
        if (typeof WINDOWS === "undefined") return;
        for (const win of WINDOWS) {
            if (!win.dishes || win.dishes.length === 0) continue;
            // 给每道菜一个人气分：正态分布 + 少数菜特别高
            const scores = win.dishes.map(() => {
                // 基础分：0.3 ~ 0.8 的均匀分布
                let base = 0.3 + Math.random() * 0.5;
                // 15% 概率成为"网红菜"：额外 +0.2 ~ 0.4
                if (Math.random() < 0.15) base += 0.2 + Math.random() * 0.2;
                return Math.min(base, 1.0);
            });
            // 排名归一化：让最热门的菜分数最高
            const sorted = [...scores].sort((a, b) => b - a);
            win.dishes.forEach((dish, i) => {
                dish.popularity = scores[i];
                dish._rank = sorted.indexOf(scores[i]);
            });
        }
    }

    /**
     * 加权随机选择：按 popularity 权重概率选 count 个不重复的菜
     */
    function weightedPickDishes(dishes, count) {
        if (!dishes || dishes.length === 0) return [];
        count = Math.min(count, dishes.length);

        // 用轮盘赌算法选不重复的
        const pool = dishes.map((d, i) => ({ d, w: d.popularity || 0.5, i }));
        const picked = [];

        for (let k = 0; k < count; k++) {
            const total = pool.reduce((s, p) => s + p.w, 0);
            if (total <= 0) break;
            let r = Math.random() * total;
            let idx = 0;
            for (let j = 0; j < pool.length; j++) {
                r -= pool[j].w;
                if (r <= 0) { idx = j; break; }
            }
            picked.push(pool[idx].d);
            pool.splice(idx, 1);
        }
        return picked;
    }

    function randomScore() {
        const r = Math.random();
        if (r < 0.05) return 1;
        if (r < 0.15) return 2;
        if (r < 0.45) return 3;
        if (r < 0.80) return 4;
        return 5;
    }

    function pickTagsByScore(score, posArr, negArr) {
        posArr = posArr || [];
        negArr = negArr || [];
        if (score >= 4) {
            const pos = pickRandom(posArr, 2, 4);
            const neg = Math.random() > 0.7 ? pickRandom(negArr, 1, 1) : [];
            return [...pos, ...neg];
        } else if (score <= 2) {
            const neg = pickRandom(negArr, 2, 3);
            const pos = Math.random() > 0.7 ? pickRandom(posArr, 1, 1) : [];
            return [...pos, ...neg];
        } else {
            return [
                ...pickRandom(posArr, 1, 2),
                ...pickRandom(negArr, 1, 2),
            ];
        }
    }

    function waitForSurveyReady() {
        return new Promise((resolve) => {
            let tries = 0;
            const check = () => {
                tries++;
                if (
                    typeof WINDOWS !== "undefined" && WINDOWS.length > 0 &&
                    typeof surveyState !== "undefined" &&
                    typeof renderWindowCards === "function" &&
                    typeof bindCardEvents === "function" &&
                    typeof submitSurvey === "function"
                ) {
                    resolve();
                } else if (tries < 100) {
                    setTimeout(check, 100);
                } else {
                    console.warn("auto-fill: survey.js 未完全加载");
                    resolve();
                }
            };
            check();
        });
    }

    // ---------- 暂停检查 ----------

    async function checkPause() {
        while (isPaused && !stopRequested) {
            await sleep(200);
        }
        return stopRequested;
    }

    // ---------- DOM 交互辅助 ----------

    // 等待 DOM 更新完成
    function forceRepaint() {
        // 读取一个属性强制回流
        document.body.offsetHeight;
    }

    function safeDelay(ms) {
        return sleep(Math.round(ms / speedFactor));
    }

    // ---------- 单窗口填充（交互式 DOM 操作） ----------

    async function fillOneWindow(window, card, posTags, negTags) {
        // 1) 滚动到卡片中心 + 高亮边框
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.style.boxShadow = "0 0 0 4px #FF6B35";
        card.style.transition = "box-shadow 0.3s";
        await safeDelay(300);

        // 2) 点击星星：先点第 1 颗 → 第 score 颗（模拟逐步点击）
        const score = randomScore();
        const starsEl = card.querySelector(`.stars[data-window="${window.name}"]`);
        if (starsEl) {
            // 逐颗点亮（有动画感）
            for (let s = 1; s <= score; s++) {
                const star = starsEl.querySelector(`.star[data-score="${s}"]`);
                if (star) {
                    star.click();
                    await safeDelay(80);
                }
            }
        }
        await safeDelay(200);

        // 3) 选标签（正面 + 负面，根据评分倾向）
        const allPos = card.querySelectorAll('.tag-options[data-type="positive"] .tag-option');
        const allNeg = card.querySelectorAll('.tag-options[data-type="negative"] .tag-option');
        const tags = pickTagsByScore(score, posTags, negTags);

        tags.forEach((tagText) => {
            const target = card.querySelector(`.tag-option[data-tag="${CSS.escape(tagText)}"]`);
            if (target && !target.classList.contains("selected")) {
                target.click();
                // 选中时加个临时闪烁效果
                target.style.transition = "transform 0.15s";
                target.style.transform = "scale(1.15)";
                setTimeout(() => { target.style.transform = ""; }, 150 / speedFactor);
            }
        });
        await safeDelay(300);

        // 4) 菜品选择器（如果有 dishes）
        const hasDishes = window.dishes && window.dishes.length > 0;
        let selectedDishes = [];
        if (hasDishes && Math.random() > 0.15) { // 85% 概率选菜品
            const dishToggle = card.querySelector(".dish-toggle");
            const dishPanel = card.querySelector('[data-role="dish-panel"]');
            if (dishToggle && dishPanel) {
                // 展开
                dishToggle.click();
                await safeDelay(200);

                // 按人气权重选 1-3 道菜（热门菜更容易被选中 → 多学生重复投票 → 有意义的票数梯度）
                const numDishes = Math.min(Math.floor(Math.random() * 3) + 1, window.dishes.length);
                selectedDishes = weightedPickDishes(window.dishes, numDishes);

                for (const dish of selectedDishes) {
                    const cb = card.querySelector(`.dish-item[data-dish="${CSS.escape(dish.name)}"] input[type='checkbox']`);
                    if (cb && !cb.checked) {
                        cb.click();
                        await safeDelay(150);
                    }
                }

                // 折叠面板（让菜品评价输入框显示出来）
                dishToggle.click();
                await safeDelay(250);

                // 给每道菜填标签 + 投票
                for (const dish of selectedDishes) {
                    const row = card.querySelector(`.dish-input-row[data-dish="${CSS.escape(dish.name)}"]`);
                    if (!row) continue;

                    // 菜品标签
                    const posDishTags = row.querySelectorAll(".dish-tag--pos");
                    const negDishTags = row.querySelectorAll(".dish-tag--neg");
                    const tagPool = score >= 3 ? posDishTags : negDishTags;
                    const numTags = Math.min(Math.floor(Math.random() * 2) + 1, tagPool.length);
                    const shuffledTags = [...tagPool].sort(() => Math.random() - 0.5);
                    for (let t = 0; t < numTags; t++) {
                        const tg = shuffledTags[t];
                        if (tg && !tg.classList.contains("selected")) {
                            tg.click();
                            await safeDelay(100);
                        }
                    }

                    // 按人气加权投票：人气越高越容易被投（基础 40% + 人气分 * 50%）
                    const voteProb = 0.4 + (dish.popularity || 0.5) * 0.5;
                    if (Math.random() < voteProb) {
                        const voteBtn = row.querySelector(".dish-vote-btn");
                        if (voteBtn && !voteBtn.classList.contains("voted")) {
                            voteBtn.click();
                            await safeDelay(150);
                        }
                    }
                }

                // 填菜品评论（30% 概率）
                if (Math.random() > 0.7 && selectedDishes.length > 0) {
                    const dishWithComment = selectedDishes[0];
                    const row = card.querySelector(`.dish-input-row[data-dish="${CSS.escape(dishWithComment.name)}"] textarea`);
                    if (row) {
                        row.focus();
                        const text = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
                        for (const ch of text) {
                            row.value += ch;
                            row.dispatchEvent(new Event("input", { bubbles: true }));
                            if (speedFactor >= 1) await safeDelay(30);
                        }
                    }
                }
            }
        }

        // 5) 窗口级评论（50% 概率）
        if (Math.random() > 0.5) {
            const commentArea = card.querySelector(".comment-row textarea");
            if (commentArea) {
                commentArea.focus();
                const text = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
                if (text) {
                    for (const ch of text) {
                        commentArea.value += ch;
                        commentArea.dispatchEvent(new Event("input", { bubbles: true }));
                        if (speedFactor >= 1) await safeDelay(25);
                    }
                }
            }
        }

        // 取消高亮
        card.style.boxShadow = "";

        // 返回这次填的数据（供调试）
        return { score, tags: tags.length, dishes: selectedDishes.length };
    }

    // ---------- 主流程：模拟一个学生填完整份问卷 ----------

    async function simulateOneStudent(studentIdx, totalStudents) {
        // 全部重置
        Object.keys(surveyState).forEach((name) => {
            surveyState[name] = { score: 0, tags: [], comment: "", dishEvaluations: [] };
        });

        // 切到全部食堂
        if (typeof currentCanteen !== "undefined") currentCanteen = "all";
        renderWindowCards();
        bindCardEvents();

        // 滚动回顶部
        window.scrollTo({ top: 0, behavior: "smooth" });
        await safeDelay(400);

        const totalWindows = WINDOWS.length;
        let filledCount = 0;

        // 决定这个学生评价多少个窗口（50%~80%）
        const evalCount = Math.min(
            totalWindows,
            Math.max(1, Math.floor(totalWindows * (0.5 + Math.random() * 0.3)))
        );
        const shuffled = [...WINDOWS].sort(() => Math.random() - 0.5);
        const toEvaluate = new Set(shuffled.slice(0, evalCount).map((w) => w.name));

        // 逐个窗口填写
        for (let i = 0; i < totalWindows; i++) {
            if (stopRequested) return;
            if (await checkPause()) return;

            const win = WINDOWS[i];
            const card = document.querySelector(
                `.window-card[data-window="${win.name.replace(/"/g, '\\"')}"]`
            );

            // 更新进度
            const studentLabel = `👤 学生 ${studentIdx}/${totalStudents}`;
            setProgressText(`${studentLabel} · 窗口 ${i + 1}/${totalWindows}`);

            if (!card) continue;

            if (toEvaluate.has(win.name)) {
                // 只评价命中的窗口
                const result = await fillOneWindow(
                    win,
                    card,
                    typeof POSITIVE_TAGS !== "undefined" ? POSITIVE_TAGS : [],
                    typeof NEGATIVE_TAGS !== "undefined" ? NEGATIVE_TAGS : []
                );
                filledCount++;
                // 稍作停顿让用户看清这张填好的卡片
                await safeDelay(400);
            } else {
                // 不评价的窗口：快速滚过（不填数据）
                card.scrollIntoView({ behavior: "smooth", block: "center" });
                await safeDelay(120);
            }
        }

        // 全部填完 → 滚到顶部 + 滚到提交按钮
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        await safeDelay(600);

        // 更新面板：提交阶段
        setProgressText(`👤 学生 ${studentIdx} 填完 ${filledCount} 个窗口 → 提交中...`);

        // 触发提交（直接调 submitSurvey）
        try {
            const fakeEvent = { preventDefault: () => {} };
            await submitSurvey(fakeEvent);
        } catch (err) {
            console.error("提交出错:", err);
        }

        // 人设卡片弹窗保持 6 秒让用户看清
        setProgressText(`👤 学生 ${studentIdx} 人设出炉！停留 6s...`);
        await safeDelay(6000);

        // 关闭弹窗
        const closeBtn = document.getElementById("modal-close");
        const modal = document.getElementById("success-modal");
        if (closeBtn && modal && !modal.classList.contains("hidden")) {
            closeBtn.click();
            await safeDelay(500);
        }
    }

    async function runAutoDemo() {
        if (isRunning) return;
        isRunning = true;
        isPaused = false;
        stopRequested = false;
        updateControlUI();

        await waitForSurveyReady();

        // 给菜品分配人气权重（制造网红菜效应 → 票数有梯度分布）
        assignDishPopularity();

        console.log(
            `🤖 自动演示开始！模拟 ${targetStudents} 个学生，速度 ${speedFactor}x`
        );

        for (let s = 1; s <= targetStudents; s++) {
            if (stopRequested) break;
            if (await checkPause()) break;

            await simulateOneStudent(s, targetStudents);

            if (stopRequested) break;
            if (s < targetStudents) {
                setProgressText(`😴 下一个学生准备中...`);
                await safeDelay(800);
            }
        }

        isRunning = false;
        stopRequested = false;
        setProgressText("✅ 全部完成！");
        updateControlUI(true);
        console.log("✅ 自动演示完成！");
    }

    // ---------- 控制面板 UI ----------

    function createControlPanel() {
        const style = document.createElement("style");
        style.textContent = `
            #auto-fill-panel {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 9999;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.22);
                padding: 14px 16px 16px;
                min-width: 280px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                transition: transform 0.35s cubic-bezier(.4,0,.2,1);
                user-select: none;
            }
            #auto-fill-panel.collapsed {
                transform: translateY(calc(100% - 40px));
            }
            .afp-header {
                display: flex; justify-content: space-between; align-items: center;
                padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid #f0f0f0;
            }
            .afp-title { font-weight: 700; font-size: 14px; color: #333; }
            .afp-progress {
                font-size: 11px; color: #888;
                font-family: "SF Mono", Consolas, monospace;
                max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .afp-btns { display: flex; gap: 6px; margin-bottom: 10px; }
            .afp-btn {
                flex: 1; padding: 8px 0; border: none; border-radius: 8px;
                cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.15s;
            }
            .afp-btn:hover:not(:disabled) { transform: translateY(-1px); }
            .afp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
            .afp-btn--start { background: linear-gradient(135deg, #FF6B35, #FF8C42); color: #fff; }
            .afp-btn--pause { background: #f0f0f0; color: #333; }
            .afp-btn--pause.active { background: #FFF3E0; color: #E65100; }
            .afp-btn--stop  { background: #fee; color: #c62828; }
            .afp-row {
                display: flex; align-items: center; gap: 8px;
                font-size: 12px; color: #666; margin-top: 6px;
            }
            .afp-row input[type="range"] { flex: 1; accent-color: #FF6B35; cursor: pointer; }
            .afp-row input[type="number"] {
                width: 48px; padding: 2px 4px; border: 1px solid #ddd;
                border-radius: 4px; font-size: 12px; text-align: center;
            }
            .afp-toggle {
                position: absolute; top: -32px; right: 20px;
                background: #fff; border: none; border-radius: 50%;
                width: 30px; height: 30px; cursor: pointer;
                box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                font-size: 12px; display: flex; align-items: center; justify-content: center;
                transition: transform 0.3s;
            }
            .afp-toggle:hover { background: #fff8f5; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement("div");
        panel.id = "auto-fill-panel";
        panel.innerHTML = `
            <button type="button" class="afp-toggle" data-role="toggle" title="收起/展开">▼</button>
            <div class="afp-header">
                <span class="afp-title">🤖 自动演示</span>
                <span class="afp-progress" data-role="progress">就绪</span>
            </div>
            <div class="afp-btns">
                <button type="button" class="afp-btn afp-btn--start" data-role="start">▶ 开始</button>
                <button type="button" class="afp-btn afp-btn--pause" data-role="pause" disabled>⏸ 暂停</button>
                <button type="button" class="afp-btn afp-btn--stop" data-role="stop">⏹ 停止</button>
            </div>
            <div class="afp-row">
                <label>速度</label>
                <input type="range" min="0.5" max="3" step="0.5" value="1" data-role="speed">
                <span data-role="speed-label">1x</span>
            </div>
            <div class="afp-row">
                <label>学生数</label>
                <input type="number" min="1" max="20" value="${targetStudents}" data-role="students">
                <span>人</span>
            </div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('[data-role="start"]').addEventListener("click", runAutoDemo);

        panel.querySelector('[data-role="pause"]').addEventListener("click", (e) => {
            isPaused = !isPaused;
            e.target.textContent = isPaused ? "▶ 继续" : "⏸ 暂停";
            e.target.classList.toggle("active", isPaused);
            setProgressText(isPaused ? "⏸ 已暂停" : "继续执行...");
        });

        panel.querySelector('[data-role="stop"]').addEventListener("click", () => {
            stopRequested = true;
            isPaused = false;
            const pauseBtn = panel.querySelector('[data-role="pause"]');
            pauseBtn.textContent = "⏸ 暂停";
            pauseBtn.classList.remove("active");
            setProgressText("⏹ 已停止");
        });

        panel.querySelector('[data-role="speed"]').addEventListener("input", (e) => {
            speedFactor = parseFloat(e.target.value);
            panel.querySelector('[data-role="speed-label"]').textContent = speedFactor + "x";
        });

        panel.querySelector('[data-role="students"]').addEventListener("change", (e) => {
            const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 3));
            targetStudents = v;
            e.target.value = v;
        });

        panel.querySelector('[data-role="toggle"]').addEventListener("click", (e) => {
            panel.classList.toggle("collapsed");
            e.target.textContent = panel.classList.contains("collapsed") ? "▲" : "▼";
        });
    }

    function setProgressText(text) {
        const el = document.querySelector("#auto-fill-panel [data-role='progress']");
        if (el) el.textContent = text;
    }

    function updateControlUI(done = false) {
        const panel = document.querySelector("#auto-fill-panel");
        if (!panel) return;
        const startBtn = panel.querySelector('[data-role="start"]');
        const pauseBtn = panel.querySelector('[data-role="pause"]');
        if (done) {
            startBtn.disabled = false; pauseBtn.disabled = true;
        } else if (isRunning) {
            startBtn.disabled = true; pauseBtn.disabled = false;
        } else {
            startBtn.disabled = false; pauseBtn.disabled = true;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createControlPanel);
    } else {
        createControlPanel();
    }
})();
