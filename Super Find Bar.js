// ==UserScript==
// @name          Super Find Bar 11.0 - Layout & Color Perfected
// @namespace     http://tampermonkey.net/
// @version       11.0
// @description   Refined layout (single-line bar), smart CJK matching, persistent pin, and fixed dark mode visibility.
// @author        RayWu (Co-pilot with Gemini)
// @match         *://*/*
// @grant         GM_setValue
// @grant         GM_getValue
// @run-at        document-end
// ==/UserScript==

(function () {
    'use strict';

    /********************
      Constants & Storage
    ********************/
    const HOST_ID = 'sf-bar-root-v11';
    const STORAGE_KEY = 'sf-bar-config-v11';

    // Default Configuration
    const DEFAULT_CONFIG = {
        theme: {
            bg: '#202124',
            text: '#e8eaed',
            opacity: 0.95
        },
        layout: {
            mode: 'float', // 'float' | 'bar'
            position: 'top-right', 
            persistent: false 
        },
        search: {
            matchCase: false,
            wholeWord: false,
            highlightAll: true,
            ignoreAccents: true,
            regex: false,
            includeHidden: false,
            fuzzy: false,
            fuzzyMode: 'count', // 'count' | 'percent'
            fuzzyVal: 1 
        },
        // REQ 3: Removed Red (#f28b82) from palette to allow Red Cursor to shine.
        colors: [
            '#fce8b2', // Yellow
            '#ccff90', // Green
            '#8ab4f8', // Blue
            '#e6c9a8', // Beige
            '#d7aefb', // Purple
            '#fdcfe8', // Pink
            '#a7ffeb'  // Teal
        ]
    };

    let CONFIG = JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_CONFIG;
    CONFIG = { ...DEFAULT_CONFIG, ...CONFIG, theme: { ...DEFAULT_CONFIG.theme, ...CONFIG.theme }, layout: { ...DEFAULT_CONFIG.layout, ...CONFIG.layout } };

    function saveConfig() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG));
    }

    const T = {
        ph: '查找...',
        count: '{i} / {total}',
        hiddenAlert: '位于隐藏区域',
        titles: {
            prev: '上一个 (Shift+Enter)',
            next: '下一个 (Enter)',
            close: '关闭 (Esc)',
            pin: '常驻显示 (Pin)',
            adv: '设置 / 高级',
            tl: '左上悬浮', tr: '右上悬浮', bl: '左下悬浮', br: '右下悬浮',
            top: '顶部全宽 (Top Bar)', bot: '底部全宽 (Bottom Bar)'
        }
    };

    /********************
      Core Algorithms
    ********************/

    function isCJK(str) {
        return /[\u4e00-\u9fa5]/.test(str);
    }

    function getEditDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                }
            }
        }
        return matrix[b.length][a.length];
    }

    function checkFuzzy(text, term) {
        if (term.length < 2) return text.includes(term);
        const dist = getEditDistance(text, term);
        if (CONFIG.search.fuzzyMode === 'count') {
            return dist <= CONFIG.search.fuzzyVal;
        } else {
            const allowed = Math.floor(term.length * CONFIG.search.fuzzyVal);
            return dist <= allowed;
        }
    }

    function isVisible(el) {
        if (!el) return false;
        if (el.id === HOST_ID || el.closest('#' + HOST_ID)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /********************
      UI Construction
    ********************/
    let shadow, root, input, countDisplay, toast, tickBar;
    let state = { marks: [], idx: -1, visible: false };

    function init() {
        if (document.getElementById(HOST_ID)) return;

        const host = document.createElement('div');
        host.id = HOST_ID;
        // REQ 5: High Z-index
        Object.assign(host.style, { position: 'fixed', top: '0', left: '0', zIndex: 2147483647, pointerEvents: 'none' });
        document.body.appendChild(host);
        shadow = host.attachShadow({ mode: 'closed' });

        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; font-family: system-ui, sans-serif; font-size: 14px; --sf-accent: #8ab4f8; --sf-warn: #d93025; --sf-bg: ${CONFIG.theme.bg}; --sf-txt: ${CONFIG.theme.text}; }
            * { box-sizing: border-box; }
            
            .sf-box {
                position: fixed; display: flex; flex-direction: column;
                background: var(--sf-bg); color: var(--sf-txt);
                opacity: ${CONFIG.theme.opacity};
                backdrop-filter: blur(5px);
                box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                transition: transform 0.2s, opacity 0.2s;
                pointer-events: auto;
                border: 1px solid rgba(255,255,255,0.15);
            }

            /* --- FLOAT MODE (Card) --- */
            .sf-box.mode-float { width: 420px; border-radius: 12px; margin: 20px; }
            .sf-pos-top-right { top: 0; right: 0; transform: translateY(-120%); }
            .sf-pos-top-right.show { transform: translateY(0); }
            .sf-pos-top-left { top: 0; left: 0; transform: translateY(-120%); }
            .sf-pos-top-left.show { transform: translateY(0); }
            .sf-pos-bottom-right { bottom: 0; right: 0; transform: translateY(120%); }
            .sf-pos-bottom-right.show { transform: translateY(0); }
            .sf-pos-bottom-left { bottom: 0; left: 0; transform: translateY(120%); }
            .sf-pos-bottom-left.show { transform: translateY(0); }

            /* --- BAR MODE (Top/Bottom Full Width) REQ 2 --- */
            .sf-box.mode-bar {
                width: 100%; left: 0; right: 0; margin: 0; border-radius: 0; border-left: 0; border-right: 0;
                flex-direction: row; align-items: center; padding: 0 16px; height: 50px;
            }
            .sf-pos-top { top: 0; transform: translateY(-100%); }
            .sf-pos-top.show { transform: translateY(0); }
            .sf-pos-bottom { bottom: 0; transform: translateY(100%); border-top: 1px solid rgba(255,255,255,0.2); border-bottom: 0; }
            .sf-pos-bottom.show { transform: translateY(0); }
            
            /* In Bar Mode, arrange children differently */
            .mode-bar .sf-row.main { flex: 1; padding: 0; background: transparent; }
            .mode-bar .sf-input-wrap { max-width: 400px; margin-right: 12px; }
            .mode-bar .sf-row.opts-basic { display: flex; margin-left: 12px; padding: 0; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 12px; }
            .mode-bar .sf-adv-panel { 
                position: absolute; right: 10px; width: 420px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); 
                background: var(--sf-bg); border: 1px solid rgba(255,255,255,0.2);
            }
            .mode-bar.sf-pos-top .sf-adv-panel { top: 52px; }
            .mode-bar.sf-pos-bottom .sf-adv-panel { bottom: 52px; }

            /* Common Components */
            .sf-row { display: flex; align-items: center; padding: 8px 12px; gap: 8px; }
            .sf-row.main { background: rgba(0,0,0,0.1); }
            .sf-row.opts-basic { font-size: 12px; flex-wrap: wrap; padding-top:4px; padding-bottom:4px; }
            
            .sf-input-wrap { flex: 1; position: relative; display: flex; align-items: center; }
            input[type="text"] {
                width: 100%; background: rgba(255,255,255,0.1); border: 2px solid transparent;
                color: inherit; padding: 6px 40px 6px 8px; border-radius: 6px; outline: none;
                transition: border-color 0.2s; font-size: 14px;
            }
            input[type="text"]:focus { border-color: var(--sf-accent); }
            input[type="text"].warn-hidden { border-color: var(--sf-accent); border-style: dashed; }
            
            .sf-count { position: absolute; right: 8px; font-size: 11px; opacity: 0.7; pointer-events: none; }

            button {
                background: transparent; border: none; color: inherit; cursor: pointer;
                padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                transition: background 0.1s; min-width: 28px;
            }
            button:hover { background: rgba(255,255,255,0.15); }
            button.active { color: var(--sf-accent); background: rgba(138, 180, 248, 0.1); }
            
            /* REQ 9: Pin Icon */
            button.sf-pin { opacity: 0.4; }
            button.sf-pin.active { opacity: 1; color: var(--sf-accent); transform: rotate(0deg); }

            .sf-chk { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; opacity: 0.8; margin-right: 8px; font-size: 12px; }
            .sf-chk:hover { opacity: 1; }
            .sf-chk input { accent-color: var(--sf-accent); }
            
            .sf-adv-panel { background: rgba(0,0,0,0.2); padding: 12px; display: none; border-top: 1px solid rgba(255,255,255,0.1); }
            .sf-adv-panel.open { display: block; }

            .sf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
            .sf-group-title { font-size: 11px; opacity: 0.5; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }

            /* REQ 8: Tooltips & Layout Selectors */
            .sf-mini-map { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 50px; }
            .sf-mini-btn { height: 20px; background: rgba(255,255,255,0.2); border-radius: 2px; cursor: pointer; border: 1px solid transparent; }
            .sf-mini-btn:hover { background: var(--sf-accent); }
            .sf-mini-btn.active { background: var(--sf-accent); border-color: #fff; }
            
            .sf-bar-btn { width: 100%; height: 16px; background: rgba(255,255,255,0.2); cursor: pointer; border-radius: 2px; margin-top: 4px; border: 1px solid transparent; }
            .sf-bar-btn:hover { background: var(--sf-accent); }
            .sf-bar-btn.active { background: var(--sf-accent); border-color: #fff; }

            /* Toast */
            .sf-toast {
                position: absolute; right: 0; top: -30px; padding: 4px 8px;
                background: var(--sf-warn); color: #fff; border-radius: 4px;
                font-size: 11px; font-weight: bold; pointer-events: none;
                opacity: 0; transition: opacity 0.2s;
            }
            .sf-toast.visible { opacity: 1; }
            
            /* Fuzzy Options Visibility REQ 7 */
            .sf-fz-opts { display: none; margin-left: 20px; font-size: 11px; align-items: center; gap: 6px; margin-top: 4px; }
            .sf-fz-opts.show { display: flex; }
        `;
        shadow.appendChild(style);

        root = document.createElement('div');
        
        // --- 1. Main Row (Input + Nav + Pin + Close) ---
        const mainRow = document.createElement('div');
        mainRow.className = 'sf-row main';

        const inputWrap = document.createElement('div');
        inputWrap.className = 'sf-input-wrap';
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = T.ph;
        countDisplay = document.createElement('div');
        countDisplay.className = 'sf-count';
        
        // Toast inside input wrap for relative positioning
        toast = document.createElement('div');
        toast.className = 'sf-toast';
        toast.textContent = T.hiddenAlert;
        
        inputWrap.append(input, countDisplay, toast);

        const btnPrev = mkBtn('▲', T.titles.prev, () => go(-1));
        const btnNext = mkBtn('▼', T.titles.next, () => go(1));
        const btnAdv = mkBtn('⚙', T.titles.adv, () => toggleAdv());
        // REQ 9: Pin Icon
        const btnPin = mkBtn('📌', T.titles.pin, () => togglePin());
        btnPin.className = 'sf-pin ' + (CONFIG.layout.persistent ? 'active' : '');
        const btnClose = mkBtn('✕', T.titles.close, () => toggle(false));

        mainRow.append(inputWrap, btnPrev, btnNext, btnAdv, btnPin, btnClose);

        // --- 2. Basic Options (Quick Access) ---
        const basicRow = document.createElement('div');
        basicRow.className = 'sf-row opts-basic';
        basicRow.append(
            mkChk('highlightAll', '高亮', true),
            mkChk('matchCase', 'Aa', false),
            mkChk('wholeWord', '全词', false), // Logic handled in search
            mkChk('ignoreAccents', 'à=a', true)
        );

        // --- 3. Advanced Panel ---
        const advPanel = document.createElement('div');
        advPanel.className = 'sf-adv-panel';
        
        const grid = document.createElement('div');
        grid.className = 'sf-grid';

        // Col 1: Search Settings
        const grpSearch = document.createElement('div');
        grpSearch.innerHTML = `<div class="sf-group-title">高级搜索</div>`;
        const fzChk = mkChk('fuzzy', '模糊搜索', false);
        grpSearch.append(
            mkChk('regex', '正则模式 (Regex)', false),
            mkChk('includeHidden', '包含隐藏内容', false),
            fzChk
        );
        
        // REQ 7: Fuzzy Options Toggle
        const fzOpts = document.createElement('div');
        fzOpts.className = 'sf-fz-opts ' + (CONFIG.search.fuzzy ? 'show' : '');
        fzOpts.id = 'sf-fz-panel';
        
        const fzInput = document.createElement('input');
        fzInput.type = 'number';
        fzInput.style.cssText = "width: 45px; background: rgba(0,0,0,0.2); border:1px solid #555; color:inherit; border-radius:3px; padding:2px";
        fzInput.value = CONFIG.search.fuzzyVal;
        fzInput.onchange = (e) => { CONFIG.search.fuzzyVal = parseFloat(e.target.value); saveConfig(); search(); };

        const fzModeBtn = document.createElement('button');
        fzModeBtn.textContent = CONFIG.search.fuzzyMode === 'count' ? '字' : '%';
        fzModeBtn.title = '切换: 字符数 / 百分比';
        fzModeBtn.style.padding = '2px 6px';
        fzModeBtn.onclick = () => {
            CONFIG.search.fuzzyMode = CONFIG.search.fuzzyMode === 'count' ? 'percent' : 'count';
            fzModeBtn.textContent = CONFIG.search.fuzzyMode === 'count' ? '字' : '%';
            if(CONFIG.search.fuzzyMode === 'percent') { fzInput.value = 0.2; CONFIG.search.fuzzyVal = 0.2; }
            else { fzInput.value = 1; CONFIG.search.fuzzyVal = 1; }
            saveConfig(); search();
        };
        fzOpts.append(document.createTextNode('容错:'), fzInput, fzModeBtn);
        grpSearch.append(fzOpts);
        
        // Update visibility on check
        fzChk.querySelector('input').addEventListener('change', (e) => {
            fzOpts.classList.toggle('show', e.target.checked);
        });

        // Col 2: Layout Settings REQ 8
        const grpLayout = document.createElement('div');
        grpLayout.innerHTML = `<div class="sf-group-title">布局 & 外观</div>`;
        
        const layoutWrap = document.createElement('div');
        layoutWrap.style.display = 'flex'; layoutWrap.style.gap = '10px';
        
        const miniMap = document.createElement('div');
        miniMap.className = 'sf-mini-map';
        [['tl', 'top-left'], ['tr', 'top-right'], ['bl', 'bottom-left'], ['br', 'bottom-right']].forEach(([label, pos]) => {
            const b = document.createElement('div');
            b.className = `sf-mini-btn ${CONFIG.layout.position === pos ? 'active' : ''}`;
            b.title = T.titles[label];
            b.onclick = () => setPos(pos, 'float');
            miniMap.append(b);
        });
        
        const barWrap = document.createElement('div');
        barWrap.style.width = '30px';
        const barTop = document.createElement('div'); barTop.className = `sf-bar-btn ${CONFIG.layout.position === 'top' ? 'active' : ''}`; 
        barTop.title = T.titles.top; barTop.onclick = () => setPos('top', 'bar');
        const barBot = document.createElement('div'); barBot.className = `sf-bar-btn ${CONFIG.layout.position === 'bottom' ? 'active' : ''}`;
        barBot.title = T.titles.bot; barBot.onclick = () => setPos('bottom', 'bar');
        barWrap.append(barTop, barBot);
        
        layoutWrap.append(miniMap, barWrap);

        // BG Color
        const colorRow = document.createElement('div');
        colorRow.style.marginTop = '8px'; colorRow.style.display='flex'; colorRow.style.alignItems='center'; colorRow.style.gap='8px';
        const bgInp = document.createElement('input'); bgInp.type='color'; bgInp.value = CONFIG.theme.bg; 
        bgInp.style.cssText = "width:20px;height:20px;border:none;padding:0;cursor:pointer";
        bgInp.onchange = e => { CONFIG.theme.bg = e.target.value; applyTheme(); saveConfig(); };
        const opInp = document.createElement('input'); opInp.type='range'; opInp.min='0.5'; opInp.max='1'; opInp.step='0.05';
        opInp.value = CONFIG.theme.opacity; opInp.style.width='60px';
        opInp.oninput = e => { CONFIG.theme.opacity = e.target.value; applyTheme(); saveConfig(); };
        colorRow.append(bgInp, opInp);

        grpLayout.append(layoutWrap, colorRow);

        grid.append(grpSearch, grpLayout);
        advPanel.append(grid);

        root.append(mainRow, basicRow, advPanel);
        shadow.appendChild(root);

        applyLayout();
        initTickBar();

        // Events
        let deb;
        input.oninput = () => { clearTimeout(deb); deb = setTimeout(search, 200); };
        input.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
            }
        };
    }

    function initTickBar() {
        tickBar = document.createElement('div');
        Object.assign(tickBar.style, {
            position: 'fixed', top: '0', right: '0', width: '16px', height: '100%',
            zIndex: 2147483646, pointerEvents: 'none', display: 'none'
        });
        document.body.appendChild(tickBar);
    }

    /********************
      Logic
    ********************/

    function mkBtn(html, title, cb) {
        const b = document.createElement('button');
        b.innerHTML = html; b.title = title; b.onclick = cb; return b;
    }
    function mkChk(key, label, def) {
        const l = document.createElement('label'); l.className = 'sf-chk';
        const c = document.createElement('input'); c.type='checkbox'; c.checked = CONFIG.search[key];
        c.onchange = () => { CONFIG.search[key] = c.checked; saveConfig(); search(); };
        l.append(c, document.createTextNode(label));
        return l;
    }

    function togglePin() {
        CONFIG.layout.persistent = !CONFIG.layout.persistent;
        saveConfig();
        const btn = shadow.querySelector('.sf-pin');
        btn.classList.toggle('active', CONFIG.layout.persistent);
    }

    function toggleAdv() {
        shadow.querySelector('.sf-adv-panel').classList.toggle('open');
    }

    function setPos(pos, mode) {
        CONFIG.layout.position = pos;
        CONFIG.layout.mode = mode;
        saveConfig();
        applyLayout();
        // Update active classes manually for performance
        shadow.querySelectorAll('.sf-mini-btn, .sf-bar-btn').forEach(b => b.classList.remove('active'));
        if(mode === 'float') {
            const map = {'top-left':0, 'top-right':1, 'bottom-left':2, 'bottom-right':3};
            shadow.querySelectorAll('.sf-mini-btn')[map[pos]].classList.add('active');
        } else {
            shadow.querySelectorAll('.sf-bar-btn')[pos === 'top' ? 0 : 1].classList.add('active');
        }
    }

    function applyLayout() {
        root.className = 'sf-box';
        root.classList.add(`mode-${CONFIG.layout.mode}`);
        root.classList.add(`sf-pos-${CONFIG.layout.position}`);
        if(state.visible) root.classList.add('show');
        applyTheme();
    }

    function applyTheme() {
        root.style.setProperty('--sf-bg', CONFIG.theme.bg);
        root.style.opacity = CONFIG.theme.opacity;
    }

    function search() {
        // Cleanup
        document.querySelectorAll('sf-mark').forEach(m => {
            const p = m.parentNode;
            if(p) { p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); }
        });
        state.marks = [];
        state.idx = -1;
        tickBar.innerHTML = '';
        toast.classList.remove('visible');
        input.classList.remove('warn-hidden');

        const val = input.value;
        if (!val.trim()) { countDisplay.textContent = ''; return; }

        const { matchCase, wholeWord, regex, fuzzy, includeHidden } = CONFIG.search;
        // REQ 1: Smart Whole Word - Ignore if CJK characters present
        const effectiveWholeWord = wholeWord && !isCJK(val);

        let terms = [];
        if (regex) terms = [{ text: val, isRegex: true }];
        else terms = val.split(/,|，/).map(t => t.trim()).filter(Boolean).map(t => ({ text: t, isRegex: false }));

        if (terms.length === 0) return;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => {
                const p = n.parentNode;
                if(['SCRIPT','STYLE','TEXTAREA','NOSCRIPT','INPUT','SELECT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
                if(shadow.host.contains(p)) return NodeFilter.FILTER_REJECT;
                if(!includeHidden && !isVisible(p)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const matches = [];
        const nodes = [];
        while(walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            const originalText = node.textContent;
            const textForSearch = CONFIG.search.ignoreAccents ? originalText.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : originalText;
            let ranges = [];

            terms.forEach((termObj, termIdx) => {
                const termColor = CONFIG.colors[termIdx % CONFIG.colors.length];
                
                if (termObj.isRegex) {
                    try {
                        const re = new RegExp(termObj.text, matchCase ? 'g' : 'gi');
                        let m;
                        while ((m = re.exec(textForSearch)) !== null) ranges.push({ s: m.index, e: re.lastIndex, c: termColor });
                    } catch(e) {}
                } else if (fuzzy) {
                    const words = textForSearch.split(/([\s,.;?!，。]+)/);
                    let cursor = 0;
                    words.forEach(w => {
                        if (checkFuzzy(w, termObj.text)) ranges.push({ s: cursor, e: cursor + w.length, c: termColor });
                        cursor += w.length;
                    });
                } else {
                    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const pattern = effectiveWholeWord ? `\\b${esc(termObj.text)}\\b` : esc(termObj.text);
                    const re = new RegExp(pattern, matchCase ? 'g' : 'gi');
                    let m;
                    while ((m = re.exec(textForSearch)) !== null) ranges.push({ s: m.index, e: re.lastIndex, c: termColor });
                }
            });

            ranges.sort((a, b) => a.s - b.s);
            if (!ranges.length) return;

            // Merge overlaps simple strategy
            const clean = [ranges[0]];
            for(let i=1; i<ranges.length; i++) {
                if(ranges[i].s >= clean[clean.length-1].e) clean.push(ranges[i]);
            }

            const frag = document.createDocumentFragment();
            let last = 0;
            clean.forEach(r => {
                frag.append(document.createTextNode(originalText.substring(last, r.s)));
                const m = document.createElement('sf-mark');
                m.textContent = originalText.substring(r.s, r.e);
                m.dataset.c = r.c;
                matches.push(m);
                frag.append(m);
                last = r.e;
            });
            frag.append(document.createTextNode(originalText.substring(last)));
            node.parentNode.replaceChild(frag, node);
        });

        state.marks = matches;
        updateUI();
        if (matches.length > 0) go(1);
        highlightAll();
    }

    function highlightAll() {
        const show = CONFIG.search.highlightAll;
        state.marks.forEach(m => {
            m.style.backgroundColor = show ? m.dataset.c : 'transparent';
            // REQ 4: Removed color override to fix dark mode
            m.style.color = 'inherit'; 
            m.style.outline = 'none';
            m.style.boxShadow = 'none';
        });
        
        if (state.idx > -1 && state.marks[state.idx]) {
            const active = state.marks[state.idx];
            // REQ 3: Red border + White Glow for high contrast visibility
            active.style.outline = '2px solid #ff3333';
            active.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.8), 0 0 8px rgba(255,0,0,0.6)';
            active.style.borderRadius = '2px';
            active.style.zIndex = 999;
            active.scrollIntoView({block:'center', behavior:'smooth'});
        }
        drawTickBar();
    }

    function drawTickBar() {
        tickBar.innerHTML = '';
        if(!state.marks.length) { tickBar.style.display='none'; return; }
        tickBar.style.display='block';
        const h = document.documentElement.scrollHeight;
        
        state.marks.forEach((m, i) => {
            const top = window.scrollY + m.getBoundingClientRect().top;
            const pct = (top / h) * 100;
            const isAct = i === state.idx;
            
            // REQ 6: Enhanced Triangle Marker
            const mark = document.createElement('div');
            mark.style.cssText = `position:absolute; right:0; top:${pct}%; transform:translateY(-50%); pointer-events:none;`;
            
            if (isAct) {
                // Large Red Triangle
                mark.style.borderRight = '10px solid #ff3333'; // Larger triangle
                mark.style.borderTop = '6px solid transparent';
                mark.style.borderBottom = '6px solid transparent';
                mark.style.zIndex = 999;
                // Add a white dot inside for style
                const dot = document.createElement('div');
                dot.style.cssText = "position:absolute;right:-9px;top:-2px;width:4px;height:4px;background:#fff;border-radius:50%";
                mark.appendChild(dot);
            } else {
                // Standard Tick
                mark.style.width = '10px';
                mark.style.height = '4px';
                mark.style.background = m.dataset.c;
                mark.style.opacity = 0.8;
            }
            tickBar.appendChild(mark);
        });
    }

    function go(dir) {
        if (!state.marks.length) return;
        state.idx = (state.idx + dir + state.marks.length) % state.marks.length;
        
        const el = state.marks[state.idx];
        const isHidden = !isVisible(el);
        
        toast.classList.toggle('visible', isHidden);
        input.classList.toggle('warn-hidden', isHidden);
        
        highlightAll();
        updateUI();
    }

    function updateUI() {
        countDisplay.textContent = state.marks.length ? T.count.replace('{i}', state.idx + 1).replace('{total}', state.marks.length) : '';
    }

    function toggle(force) {
        if (!root) init();
        const next = (force !== undefined) ? force : !state.visible;
        state.visible = next;
        root.classList.toggle('show', next);
        
        if (next) {
            setTimeout(() => input.focus(), 50);
            if (input.value && state.marks.length === 0) search();
        } else {
            // Clean highlight on close
            document.querySelectorAll('sf-mark').forEach(m => {
                const p = m.parentNode;
                if(p) { p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); }
            });
            state.marks = [];
            tickBar.style.display = 'none';
        }
    }

    // Global Styles
    const globalStyle = document.createElement('style');
    globalStyle.textContent = `sf-mark { all: unset; display: inline; border-radius: 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; color: inherit; }`;
    document.head.appendChild(globalStyle);

    // REQ 5: Capture Phase Listener
    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation(); // Stop Gemini/Docs from stealing it
            toggle();
        }
        if (e.key === 'F3' && state.visible) {
            e.preventDefault(); e.stopImmediatePropagation();
            go(e.shiftKey ? -1 : 1);
        }
        if (e.key === 'Escape' && state.visible) {
            e.preventDefault(); e.stopImmediatePropagation();
            toggle(false);
        }
    }, true); // TRUE = Capture Phase

    if (CONFIG.layout.persistent) {
        window.addEventListener('load', () => toggle(true));
    }

})();
