// ==UserScript==
// @name          Super Find Bar 18.0 - CSS Highlight API
// @namespace     http://tampermonkey.net/
// @version       18.0
// @description   Non-destructive highlighting using CSS Highlight API. Zero DOM mutations, zero crashes.
// @author        RayWu (Co-pilot with Gemini)
// @match         *://*/*
// @grant         GM_setValue
// @grant         GM_getValue
// @run-at        document-start
// ==/UserScript==

(function () {
    'use strict';

    /********************
      1. 配置与常量
    ********************/
    const HOST_ID = 'sf-bar-root-v18';
    const BTN_ID = 'sf-launch-btn-v18';
    const STORAGE_KEY = 'sf-bar-config-v18';

    const DEFAULT_CONFIG = {
        theme: { bg: '#202124', text: '#e8eaed', opacity: 0.95 },
        layout: { mode: 'float', position: 'top-right', persistent: false },
        search: {
            matchCase: false, wholeWord: false, highlightAll: true,
            ignoreAccents: true, regex: false, includeHidden: false,
            fuzzy: false, fuzzyTolerance: 1,
            pinned: ['matchCase', 'wholeWord', 'ignoreAccents', 'highlightAll'],
            perfThreshold: 3000
        },
        colors: ['#fce8b2', '#ccff90', '#8ab4f8', '#e6c9a8', '#d7aefb', '#fdcfe8', '#a7ffeb'],
        lang: 'zh'
    };

    let CONFIG = JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_CONFIG;
    CONFIG = { 
        ...DEFAULT_CONFIG, ...CONFIG, 
        theme: { ...DEFAULT_CONFIG.theme, ...CONFIG.theme }, 
        layout: { ...DEFAULT_CONFIG.layout, ...CONFIG.layout },
        search: { ...DEFAULT_CONFIG.search, ...CONFIG.search },
        colors: CONFIG.colors || DEFAULT_CONFIG.colors
    };
    if(!CONFIG.lang) CONFIG.lang = 'zh';

    function saveConfig() { localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG)); }

    // i18n
    const I18N = {
        zh: {
            ph: '查找（多字段搜索"，"隔开）...',
            phFuzzy: '模糊模式：输入后按 Enter 计算...',
            phManual: '页面内容过多：输入后按 Enter 计算...',
            count: '{i} / {total}',
            hiddenAlert: '位于隐藏区域',
            noSupport: '浏览器不支持 CSS Highlight API',
            titles: {
                prev: '上一个 (Shift+Enter)', next: '下一个 (Enter)',
                close: '关闭 (Esc)', pin: '固定', adv: '设置', reset: '重置'
            },
            group: { tool: '工具栏显示', search: '搜索设置', layout: '布局 & 外观' },
            lbl: {
                fuzzyTol: '模糊容错 (字数)', perf: '自动搜索阈值 (节点数)',
                perfHint: '超过此数值将关闭实时搜索。',
                bg: '背景', txt: '文字', op: '背景透明度', lang: '语言 / Language'
            },
            opts: {
                matchCase: '区分大小写', wholeWord: '全词匹配', highlightAll: '高亮所有',
                ignoreAccents: '忽略重音', regex: '正则表达式', includeHidden: '包含隐藏',
                fuzzy: '模糊搜索'
            }
        },
        en: {
            ph: 'Find (comma for multiple terms)...',
            phFuzzy: 'Fuzzy Mode: Press Enter to search...',
            phManual: 'Page too large: Press Enter to search...',
            count: '{i} / {total}',
            hiddenAlert: 'Hidden Element',
            noSupport: 'Browser does not support CSS Highlight API',
            titles: {
                prev: 'Previous (Shift+Enter)', next: 'Next (Enter)',
                close: 'Close (Esc)', pin: 'Pin', adv: 'Settings', reset: 'Reset'
            },
            group: { tool: 'Toolbar Options', search: 'Search Settings', layout: 'Layout & Appearance' },
            lbl: {
                fuzzyTol: 'Fuzzy Tolerance', perf: 'Auto-Search Threshold',
                perfHint: 'Disable live search if nodes exceed this.',
                bg: 'Bg', txt: 'Txt', op: 'Bg Opacity', lang: 'Language'
            },
            opts: {
                matchCase: 'Match Case', wholeWord: 'Whole Word', highlightAll: 'Highlight All',
                ignoreAccents: 'Ignore Accents', regex: 'Regex', includeHidden: 'Include Hidden',
                fuzzy: 'Fuzzy Search'
            }
        }
    };

    function t(path) {
        const keys = path.split('.');
        let curr = I18N[CONFIG.lang];
        for(let k of keys) curr = curr[k];
        return curr;
    }

    /********************
      2. 核心算法
    ********************/

    function isCJK(str) { return /[\u4e00-\u9fa5]/.test(str); }

    function isVisible(el) {
        if (!el) return false;
        if (el.id === HOST_ID || el.id === BTN_ID || el.closest('#' + HOST_ID)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function levenshtein(s, t) {
        if (s === t) return 0;
        if (s.length === 0) return t.length;
        if (t.length === 0) return s.length;
        if (s.length > t.length) { [s, t] = [t, s]; }
        let v0 = new Int32Array(s.length + 1);
        let v1 = new Int32Array(s.length + 1);
        for (let i = 0; i <= s.length; i++) v0[i] = i;
        for (let j = 0; j < t.length; j++) {
            v1[0] = j + 1;
            for (let i = 0; i < s.length; i++) {
                const cost = s[i] === t[j] ? 0 : 1;
                v1[i + 1] = Math.min(v1[i] + 1, v0[i + 1] + 1, v0[i] + cost);
            }
            const tmp = v0; v0 = v1; v1 = tmp;
        }
        return v0[s.length];
    }

    /********************
      3. UI 构建
    ********************/
    let shadow, root, input, countDisplay, toast, tickBar, chkGroup, loadingInd, advPanel, btnAdv;
    let launchBtn;
    
    // 检测 CSS Highlight API 支持
    const SUPPORTS_HIGHLIGHT = typeof CSS !== 'undefined' && CSS.highlights;
    
    let state = { 
        ranges: [],           // Range 对象数组
        idx: -1, 
        visible: false, 
        searchId: 0, 
        isDirty: false, 
        nodeCount: 0, 
        manualMode: false,
        abortController: null
    };

    function tryInit() {
        if (document.body) {
            init();
            initLaunchBtn();
        } else {
            window.addEventListener('DOMContentLoaded', () => {
                init();
                initLaunchBtn();
            });
        }
    }

    function initLaunchBtn() {
        if (document.getElementById(BTN_ID)) return;
        launchBtn = document.createElement('div');
        launchBtn.id = BTN_ID;
        Object.assign(launchBtn.style, {
            position: 'fixed', bottom: '20px', right: '20px', 
            width: '40px', height: '40px', borderRadius: '50%',
            background: CONFIG.theme.bg, color: CONFIG.theme.text,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 2147483646, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', opacity: '0.6', transition: 'opacity 0.2s',
            pointerEvents: 'auto'
        });
        launchBtn.textContent = '🔍';
        launchBtn.title = 'Super Find Bar';
        launchBtn.onclick = () => toggle(true);
        launchBtn.onmouseenter = () => launchBtn.style.opacity = '1';
        launchBtn.onmouseleave = () => launchBtn.style.opacity = '0.6';
        document.body.appendChild(launchBtn);
    }

    function init() {
        if (document.getElementById(HOST_ID)) return;

        const host = document.createElement('div');
        host.id = HOST_ID;
        Object.assign(host.style, { position: 'fixed', top: '0', left: '0', zIndex: 2147483647, pointerEvents: 'none' });
        document.body.appendChild(host);
        shadow = host.attachShadow({ mode: 'closed' });

        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; font-family: system-ui, sans-serif; font-size: 14px; --sf-accent: #8ab4f8; --sf-warn: #d93025; --sf-bg: ${CONFIG.theme.bg}; --sf-txt: ${CONFIG.theme.text}; }
            * { box-sizing: border-box; }
            
            .sf-box {
                position: fixed; display: flex; background: var(--sf-bg); color: var(--sf-txt);
                opacity: ${CONFIG.theme.opacity}; backdrop-filter: blur(5px);
                box-shadow: 0 8px 24px rgba(0,0,0,0.4); transition: transform 0.2s, opacity 0.2s;
                pointer-events: auto; border: 1px solid rgba(255,255,255,0.15);
            }

            .sf-box.mode-float { flex-direction: column; width: 485px; border-radius: 12px; margin: 20px; padding: 10px; }
            .mode-float .sf-row-top { display: flex; align-items: center; gap: 8px; width: 100%; }
            .mode-float .sf-row-bot { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); }
            .mode-float .sf-chk-group { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

            .sf-pos-top-right { top: 0; right: 0; transform: translateY(-120%); }
            .sf-pos-top-right.show { transform: translateY(0); }
            .sf-pos-top-left { top: 0; left: 0; transform: translateY(-120%); }
            .sf-pos-top-left.show { transform: translateY(0); }
            .sf-pos-bottom-right { bottom: 0; right: 0; transform: translateY(120%); }
            .sf-pos-bottom-right.show { transform: translateY(0); }
            .sf-pos-bottom-left { bottom: 0; left: 0; transform: translateY(120%); }
            .sf-pos-bottom-left.show { transform: translateY(0); }

            .sf-box.mode-bar { width: 100%; left: 0; right: 0; margin: 0; border-radius: 0; border: 0;
                flex-direction: row; align-items: center; padding: 0 16px; height: 50px; justify-content: flex-start; gap: 8px; }
            .sf-pos-top { top: 0; transform: translateY(-100%); border-bottom: 1px solid rgba(255,255,255,0.1); }
            .sf-pos-top.show { transform: translateY(0); }
            .sf-pos-bottom { bottom: 0; transform: translateY(100%); border-top: 1px solid rgba(255,255,255,0.1); }
            .sf-pos-bottom.show { transform: translateY(0); }
            
            .mode-bar .sf-row-top, .mode-bar .sf-row-bot { display: contents; } 
            .mode-bar .sf-input-wrap { order: 1; flex: 0 1 350px; }
            .mode-bar .sf-btn-prev { order: 2; }
            .mode-bar .sf-btn-next { order: 3; }
            .mode-bar .sf-btn-adv { order: 4; margin-right: 12px; }
            .mode-bar .sf-chk-group { order: 5; display: flex; align-items: center; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 12px; }
            .mode-bar .sf-btn-pin { order: 99; margin-left: auto; margin-right: 4px; }
            .mode-bar .sf-btn-close { order: 100; }
            .mode-float .sf-btn-pin { margin-left: auto; }

            .sf-input-wrap { position: relative; display: flex; align-items: center; flex-grow: 1; }
            input[type="text"] { width: 100%; background: rgba(255,255,255,0.1); border: 2px solid transparent;
                color: inherit; padding: 6px 40px 6px 8px; border-radius: 6px; outline: none;
                transition: border-color 0.2s; font-size: 14px; }
            input[type="text"]:focus { border-color: var(--sf-accent); }
            input[type="text"].warn-hidden { border-color: var(--sf-accent); border-style: dashed; }
            
            .sf-count { position: absolute; right: 8px; font-size: 11px; opacity: 0.7; pointer-events: none; transition: opacity 0.2s; }
            .sf-loading { position: absolute; right: 8px; width: 14px; height: 14px;
                border: 2px solid rgba(255,255,255,0.3); border-top-color: var(--sf-accent);
                border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
            @keyframes spin { to { transform: rotate(360deg); } }

            button { background: transparent; border: none; color: inherit; cursor: pointer;
                padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                transition: background 0.1s; min-width: 28px; height: 28px; flex-shrink: 0; }
            button:hover { background: rgba(255,255,255,0.15); }
            button.active { color: var(--sf-accent); background: rgba(138, 180, 248, 0.1); }
            .sf-btn-pin.active { color: #ff5555; opacity: 1; transform: none; }

            .sf-chk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; 
                opacity: 0.8; font-size: 12px; margin-right: 8px; background: rgba(255,255,255,0.05); padding: 2px 6px; 
                border-radius: 4px; white-space: nowrap; }
            .sf-chk:hover { opacity: 1; background: rgba(255,255,255,0.1); }
            .sf-chk input { accent-color: var(--sf-accent); margin: 0; }
            
            .sf-adv-panel { display: none; background: var(--sf-bg); border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                width: 340px; z-index: 2147483648; color: var(--sf-txt); }
            .sf-adv-panel.open { display: block; }
            .mode-float .sf-adv-panel { margin-top: 12px; width: 100%; }
            .mode-bar .sf-adv-panel { position: fixed; } 

            .sf-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
            .sf-group-title { font-size: 11px; opacity: 0.5; text-transform: uppercase; font-weight: bold; 
                margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 2px;
                display:flex; justify-content: space-between; align-items: center; }
            .sf-adv-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; flex-wrap: wrap;}
            .sf-adv-lbl { font-size: 13px; }
            .sf-hint { font-size: 10px; color: #ff9800; margin-top: 2px; line-height: 1.2; width: 100%; }

            .sf-mini-map { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 60px; }
            .sf-mini-btn { height: 24px; background: rgba(255,255,255,0.1); border-radius: 2px; cursor: pointer; border: 1px solid transparent; }
            .sf-mini-btn:hover { background: var(--sf-accent); }
            .sf-mini-btn.active { background: var(--sf-accent); border-color: #fff; }
            .sf-bar-btn { width: 100%; height: 20px; background: rgba(255,255,255,0.1); cursor: pointer; border-radius: 2px; 
                margin-top: 4px; border: 1px solid transparent; text-align:center; line-height:18px; font-size:10px;}
            .sf-bar-btn:hover { background: var(--sf-accent); }
            .sf-bar-btn.active { background: var(--sf-accent); border-color: #fff; }

            .sf-toast { position: absolute; right: 0; top: -30px; padding: 4px 8px;
                background: var(--sf-warn); color: #fff; border-radius: 4px;
                font-size: 11px; font-weight: bold; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
            .sf-toast.visible { opacity: 1; }

            .sf-lang-switch { display: flex; background: rgba(255,255,255,0.1); border-radius: 4px; padding: 2px; cursor: pointer; }
            .sf-lang-opt { padding: 2px 8px; border-radius: 2px; font-size: 11px; opacity: 0.6; transition: 0.2s; }
            .sf-lang-opt.active { background: var(--sf-accent); color: #fff; opacity: 1; font-weight: bold; }
        `;
        shadow.appendChild(style);

        root = document.createElement('div');
        
        const topRow = document.createElement('div');
        topRow.className = 'sf-row-top';

        const inputWrap = document.createElement('div');
        inputWrap.className = 'sf-input-wrap';
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = t('ph'); 
        
        countDisplay = document.createElement('div');
        countDisplay.className = 'sf-count';
        
        loadingInd = document.createElement('div');
        loadingInd.className = 'sf-loading';

        toast = document.createElement('div');
        toast.className = 'sf-toast';
        toast.textContent = t('hiddenAlert');
        
        inputWrap.append(input, countDisplay, loadingInd, toast);

        const btnPrev = mkBtn('▲', t('titles.prev'), () => go(-1), 'sf-btn-prev');
        const btnNext = mkBtn('▼', t('titles.next'), () => go(1), 'sf-btn-next');
        btnAdv = mkBtn('⚙', t('titles.adv'), (e) => toggleAdv(e), 'sf-btn-adv');
        const btnPin = mkBtn('📌', t('titles.pin'), () => togglePin(), 'sf-btn-pin ' + (CONFIG.layout.persistent ? 'active' : ''));
        const btnClose = mkBtn('✕', t('titles.close'), () => toggle(false), 'sf-btn-close');

        topRow.append(inputWrap, btnPrev, btnNext, btnAdv, btnPin, btnClose);

        const botRow = document.createElement('div');
        botRow.className = 'sf-row-bot';
        chkGroup = document.createElement('div');
        chkGroup.className = 'sf-chk-group';
        botRow.appendChild(chkGroup);

        advPanel = document.createElement('div');
        advPanel.className = 'sf-adv-panel';
        renderAdvPanel();

        root.append(topRow, botRow, advPanel);
        shadow.appendChild(root);

        renderCheckboxes(chkGroup);
        applyLayout();
        initTickBar();

        let deb;
        input.oninput = () => { 
            state.isDirty = true;
            if (CONFIG.search.fuzzy || state.manualMode) return;
            clearTimeout(deb); 
            const delay = state.nodeCount > CONFIG.search.perfThreshold ? 500 : 200;
            deb = setTimeout(triggerSearch, delay);
        };
        input.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                if (state.isDirty || state.ranges.length === 0) {
                    triggerSearch();
                } else {
                    go(e.shiftKey ? -1 : 1);
                }
            }
        };

        // Click Outside
        document.addEventListener('mousedown', (e) => {
            if (!state.visible) return;
            const host = document.getElementById(HOST_ID);
            if (host && !host.contains(e.target)) {
                if (advPanel.classList.contains('open')) {
                    advPanel.classList.remove('open');
                }
            }
        });
        root.addEventListener('mousedown', (e) => {
            if (advPanel.classList.contains('open')) {
                const path = e.composedPath();
                if (!path.includes(advPanel) && !path.includes(btnAdv)) {
                    advPanel.classList.remove('open');
                }
            }
        });

        // 显示兼容性警告
        if (!SUPPORTS_HIGHLIGHT) {
            toast.textContent = t('noSupport');
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 5000);
        }
    }

    function renderAdvPanel() {
        advPanel.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'sf-grid';

        // Group 1: Toolbar
        const grpTools = document.createElement('div');
        grpTools.innerHTML = `<div class="sf-group-title">${t('group.tool')}</div>`;
        const toolList = ['regex', 'includeHidden', 'fuzzy', 'matchCase', 'wholeWord', 'ignoreAccents', 'highlightAll'];
        toolList.forEach(key => {
            const row = document.createElement('div');
            row.className = 'sf-adv-row';
            const lbl = document.createElement('span');
            lbl.className = 'sf-adv-lbl';
            lbl.textContent = t(`opts.${key}`);
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = CONFIG.search.pinned.includes(key);
            chk.onchange = (e) => {
                if (e.target.checked) {
                    if (!CONFIG.search.pinned.includes(key)) CONFIG.search.pinned.push(key);
                } else {
                    CONFIG.search.pinned = CONFIG.search.pinned.filter(k => k !== key);
                }
                saveConfig();
                renderCheckboxes(chkGroup);
            };
            row.append(lbl, chk);
            grpTools.append(row);
        });

        // Group 2: Search Settings
        const grpSearch = document.createElement('div');
        grpSearch.innerHTML = `<div class="sf-group-title">${t('group.search')}</div>`;
        
        const fuzzyRow = document.createElement('div');
        fuzzyRow.className = 'sf-adv-row';
        fuzzyRow.style.flexWrap = 'wrap';
        fuzzyRow.innerHTML = `<span class="sf-adv-lbl">${t('lbl.fuzzyTol')}</span>`;
        const fuzzyVal = document.createElement('span');
        fuzzyVal.style.fontSize = '12px'; fuzzyVal.style.marginLeft = 'auto'; fuzzyVal.textContent = CONFIG.search.fuzzyTolerance;
        const fuzzyRange = document.createElement('input');
        fuzzyRange.type = 'range'; fuzzyRange.min = '0'; fuzzyRange.max = '5'; fuzzyRange.step = '1';
        fuzzyRange.style.width = '100%'; fuzzyRange.style.marginTop = '4px';
        fuzzyRange.value = CONFIG.search.fuzzyTolerance;
        fuzzyRange.oninput = (e) => {
            CONFIG.search.fuzzyTolerance = parseInt(e.target.value);
            fuzzyVal.textContent = CONFIG.search.fuzzyTolerance;
            saveConfig();
        };
        fuzzyRow.append(fuzzyVal, fuzzyRange);

        const perfRow = document.createElement('div');
        perfRow.className = 'sf-adv-row';
        perfRow.style.marginTop = '8px';
        perfRow.innerHTML = `<span class="sf-adv-lbl">${t('lbl.perf')}</span>`;
        const perfCtrl = document.createElement('div');
        perfCtrl.style.display = 'flex'; perfCtrl.style.gap = '4px'; perfCtrl.style.marginLeft = 'auto';
        const perfInp = document.createElement('input');
        perfInp.type = 'number'; perfInp.value = CONFIG.search.perfThreshold;
        perfInp.style.width = '60px'; perfInp.style.background = 'rgba(255,255,255,0.1)'; perfInp.style.border = 'none'; 
        perfInp.style.color='inherit'; perfInp.style.borderRadius='4px'; perfInp.style.padding='2px';
        perfInp.onchange = (e) => {
            let v = parseInt(e.target.value);
            if(isNaN(v) || v < 0) v = 3000;
            CONFIG.search.perfThreshold = v;
            saveConfig();
        };
        const btnReset = mkBtn(t('titles.reset'), 'Default 3000', () => {
            CONFIG.search.perfThreshold = 3000;
            perfInp.value = 3000;
            saveConfig();
        });
        btnReset.style.fontSize = '10px'; btnReset.style.padding='2px 4px';
        perfCtrl.append(perfInp, btnReset);
        perfRow.append(perfCtrl);
        const perfHint = document.createElement('div');
        perfHint.className = 'sf-hint';
        perfHint.textContent = t('lbl.perfHint');
        grpSearch.append(fuzzyRow, perfRow, perfHint);

        // Group 3: Layout
        const grpLayout = document.createElement('div');
        grpLayout.innerHTML = `<div class="sf-group-title">${t('group.layout')}</div>`;
        
        const langRow = document.createElement('div');
        langRow.className = 'sf-adv-row';
        langRow.innerHTML = `<span class="sf-adv-lbl">${t('lbl.lang')}</span>`;
        const langSwitch = document.createElement('div');
        langSwitch.className = 'sf-lang-switch';
        const optZh = document.createElement('div'); optZh.className = `sf-lang-opt ${CONFIG.lang === 'zh' ? 'active' : ''}`;
        optZh.textContent = '中文';
        optZh.onclick = () => switchLang('zh');
        const optEn = document.createElement('div'); optEn.className = `sf-lang-opt ${CONFIG.lang === 'en' ? 'active' : ''}`;
        optEn.textContent = 'EN';
        optEn.onclick = () => switchLang('en');
        langSwitch.append(optZh, optEn);
        langRow.appendChild(langSwitch);
        
        const layoutRow = document.createElement('div');
        layoutRow.style.display = 'flex'; layoutRow.style.justifyContent = 'space-between';
        const miniMap = document.createElement('div');
        miniMap.className = 'sf-mini-map';
        [['tl', 'top-left'], ['tr', 'top-right'], ['bl', 'bottom-left'], ['br', 'bottom-right']].forEach(([label, pos]) => {
            const b = document.createElement('div');
            b.className = `sf-mini-btn ${CONFIG.layout.position === pos ? 'active' : ''}`;
            b.title = t(`titles.${label}`);
            b.onclick = () => setPos(pos, 'float');
            miniMap.append(b);
        });
        const barWrap = document.createElement('div');
        barWrap.style.width = '40px';
        const barTop = document.createElement('div'); barTop.className = `sf-bar-btn ${CONFIG.layout.position === 'top' ? 'active' : ''}`; 
        barTop.textContent = 'TOP'; barTop.onclick = () => setPos('top', 'bar');
        const barBot = document.createElement('div'); barBot.className = `sf-bar-btn ${CONFIG.layout.position === 'bottom' ? 'active' : ''}`;
        barBot.textContent = 'BOT'; barBot.onclick = () => setPos('bottom', 'bar');
        barWrap.append(barTop, barBot);
        layoutRow.append(miniMap, barWrap);

        const colorRow = document.createElement('div');
        colorRow.style.marginTop = '8px'; colorRow.style.display='flex'; colorRow.style.alignItems='center'; colorRow.style.justifyContent='space-between';
        const c1 = document.createElement('div'); c1.style.display='flex'; c1.style.alignItems='center'; c1.style.gap='4px';
        const bgInp = document.createElement('input'); bgInp.type='color'; bgInp.value = CONFIG.theme.bg; 
        bgInp.style.cssText = "width:20px;height:20px;border:none;padding:0;cursor:pointer;border-radius:4px";
        bgInp.onchange = e => { CONFIG.theme.bg = e.target.value; applyTheme(); saveConfig(); };
        c1.append(document.createTextNode(t('lbl.bg')), bgInp);
        const c2 = document.createElement('div'); c2.style.display='flex'; c2.style.alignItems='center'; c2.style.gap='4px';
        const txtInp = document.createElement('input'); txtInp.type='color'; txtInp.value = CONFIG.theme.text;
        txtInp.style.cssText = "width:20px;height:20px;border:none;padding:0;cursor:pointer;border-radius:4px";
        txtInp.onchange = e => { CONFIG.theme.text = e.target.value; applyTheme(); saveConfig(); };
        c2.append(document.createTextNode(t('lbl.txt')), txtInp);
        colorRow.append(c1, c2);

        const opRow = document.createElement('div');
        opRow.className = 'sf-adv-row'; opRow.style.marginTop = '4px';
        opRow.innerHTML = `<span class="sf-adv-lbl">${t('lbl.op')}</span>`;
        const opVal = document.createElement('span');
        opVal.style.fontSize = '12px'; opVal.style.marginLeft='auto'; opVal.style.marginRight='8px';
        opVal.textContent = Math.round(CONFIG.theme.opacity * 100) + '%';
        const opInp = document.createElement('input'); opInp.type='range'; opInp.min='0.5'; opInp.max='1'; opInp.step='0.05';
        opInp.value = CONFIG.theme.opacity; opInp.style.width='80px';
        opInp.oninput = e => { 
            CONFIG.theme.opacity = e.target.value; 
            opVal.textContent = Math.round(e.target.value * 100) + '%';
            applyTheme(); saveConfig(); 
        };
        opRow.append(opVal, opInp);

        grpLayout.append(langRow, layoutRow, colorRow, opRow);
        grid.append(grpTools, grpSearch, grpLayout);
        advPanel.append(grid);
    }

    function switchLang(l) {
        CONFIG.lang = l;
        saveConfig();
        renderAdvPanel();
        renderCheckboxes(chkGroup);
        updatePlaceholder();
        shadow.querySelector('.sf-btn-prev').title = t('titles.prev');
        shadow.querySelector('.sf-btn-next').title = t('titles.next');
        shadow.querySelector('.sf-btn-close').title = t('titles.close');
        shadow.querySelector('.sf-btn-pin').title = t('titles.pin');
        shadow.querySelector('.sf-btn-adv').title = t('titles.adv');
        toast.textContent = t('hiddenAlert');
    }

    function renderCheckboxes(container) {
        container.innerHTML = '';
        const order = ['matchCase', 'wholeWord', 'ignoreAccents', 'highlightAll', 'regex', 'includeHidden', 'fuzzy'];
        order.forEach(key => {
            if (CONFIG.search.pinned.includes(key)) {
                const chk = mkChk(key, t(`opts.${key}`));
                container.appendChild(chk);
            }
        });
    }

    function updatePlaceholder() {
        if (!input) return;
        if (CONFIG.search.fuzzy) {
            input.placeholder = t('phFuzzy');
        } else if (state.manualMode) {
            input.placeholder = t('phManual');
        } else {
            input.placeholder = t('ph');
        }
    }

    function initTickBar() {
        tickBar = document.createElement('div');
        Object.assign(tickBar.style, {
            position: 'fixed', top: '0', right: '0', width: '16px', height: '100%',
            zIndex: 2147483646, pointerEvents: 'none', display: 'none'
        });
        document.body.appendChild(tickBar);
    }

    // Helper Utils
    function mkBtn(html, title, cb, cls) {
        const b = document.createElement('button');
        b.innerHTML = html; b.title = title; b.onclick = cb; 
        if(cls) b.className = cls; return b;
    }
    function mkChk(key, label) {
        const l = document.createElement('label'); l.className = 'sf-chk';
        const c = document.createElement('input'); c.type='checkbox'; c.checked = CONFIG.search[key];
        c.onchange = () => { 
            CONFIG.search[key] = c.checked; 
            saveConfig(); 
            updatePlaceholder();
            if (!CONFIG.search.fuzzy && !state.manualMode && state.isDirty) triggerSearch();
        };
        l.append(c, document.createTextNode(label)); return l;
    }
    function togglePin() {
        CONFIG.layout.persistent = !CONFIG.layout.persistent; saveConfig();
        shadow.querySelector('.sf-btn-pin').classList.toggle('active', CONFIG.layout.persistent);
    }
    function toggleAdv(e) {
        if (advPanel.classList.contains('open')) {
            advPanel.classList.remove('open');
        } else {
            advPanel.classList.add('open');
            if (CONFIG.layout.mode === 'bar') {
                const btnRect = e.currentTarget.getBoundingClientRect();
                let top = btnRect.bottom + 6;
                let right = window.innerWidth - btnRect.right;
                if (right < 10) right = 10;
                advPanel.style.position = 'fixed';
                advPanel.style.top = (CONFIG.layout.position === 'top' ? top : 'auto') + 'px';
                advPanel.style.bottom = (CONFIG.layout.position === 'bottom' ? (window.innerHeight - btnRect.top + 6) : 'auto') + 'px';
                advPanel.style.right = right + 'px'; advPanel.style.left = 'auto';
            } else {
                advPanel.style.cssText = '';
            }
        }
    }
    function setPos(pos, mode) {
        CONFIG.layout.position = pos; CONFIG.layout.mode = mode; saveConfig(); applyLayout();
        advPanel.classList.remove('open');
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
        root.style.setProperty('--sf-txt', CONFIG.theme.text); 
        root.style.opacity = CONFIG.theme.opacity;
    }

    /********************
      4. CSS Highlight API 搜索逻辑
    ********************/

    function checkPageSize() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let count = 0;
        while(walker.nextNode()) count++;
        state.nodeCount = count;
        state.manualMode = count > CONFIG.search.perfThreshold;
        if(state.manualMode && !state.hasWarned) {
             toast.textContent = `Page huge (${count} nodes). Manual mode on.`;
             toast.classList.add('visible');
             setTimeout(() => toast.classList.remove('visible'), 3000);
             state.hasWarned = true;
        }
        updatePlaceholder();
    }

    async function triggerSearch() {
        if (!SUPPORTS_HIGHLIGHT) return; // 不支持则直接返回

        // 清理旧高亮
        if (CSS.highlights) {
            CSS.highlights.clear();
        }
        
        state.isDirty = false;
        state.searchId++;
        const currentId = state.searchId;
        
        if (state.abortController) {
            state.abortController.abort = true;
        }
        state.abortController = { abort: false };
        const abortSignal = state.abortController;
        
        const val = input.value;
        const cfg = JSON.parse(JSON.stringify(CONFIG.search));
        
        state.ranges = [];
        state.idx = -1;
        tickBar.innerHTML = '';
        toast.classList.remove('visible');
        input.classList.remove('warn-hidden');
        countDisplay.textContent = '';
        
        if (!val.trim()) { 
            loadingInd.style.display = 'none'; 
            countDisplay.style.opacity = '1';
            state.abortController = null;
            return; 
        }

        loadingInd.style.display = 'block';
        countDisplay.style.opacity = '0';
        await new Promise(r => setTimeout(r, 0));
        if (abortSignal.abort) return;
        
        const effectiveWholeWord = cfg.wholeWord && !isCJK(val);
        let terms = [];
        if (cfg.regex) terms = [{ text: val, isRegex: true }];
        else terms = val.split(/,|，/).map(t => t.trim()).filter(Boolean).map(t => ({ text: t, isRegex: false }));

        if (terms.length === 0) {
            loadingInd.style.display = 'none';
            countDisplay.style.opacity = '1';
            state.abortController = null;
            return;
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => {
                const p = n.parentNode;
                if(['SCRIPT','STYLE','TEXTAREA','NOSCRIPT','INPUT','SELECT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
                if(shadow && shadow.host && shadow.host.contains(p)) return NodeFilter.FILTER_REJECT;
                if(!cfg.includeHidden && !isVisible(p)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while(walker.nextNode()) nodes.push(walker.currentNode);

        const ranges = [];
        const BATCH_SIZE = 50;
        let lastYield = performance.now();

        for (let i = 0; i < nodes.length; i++) {
            if (abortSignal.abort || state.searchId !== currentId) {
                state.abortController = null;
                return;
            }

            if (i % BATCH_SIZE === 0 && i > 0) {
                const now = performance.now();
                if (now - lastYield > 10) {
                    await new Promise(r => setTimeout(r, 0));
                    lastYield = performance.now();
                }
            }

            const node = nodes[i];
            if (!node) continue;
            
            const originalText = node.textContent;
            const textForSearch = cfg.ignoreAccents ? originalText.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : originalText;
            let matches = [];

            terms.forEach((termObj, termIdx) => {
                if (termObj.isRegex) {
                    try {
                        const re = new RegExp(termObj.text, cfg.matchCase ? 'g' : 'gi');
                        let m;
                        while ((m = re.exec(textForSearch)) !== null) matches.push({ s: m.index, e: re.lastIndex });
                    } catch(e) {}
                } else if (cfg.fuzzy) {
                    const k = cfg.fuzzyTolerance;
                    const termLen = termObj.text.length;
                    const textLen = textForSearch.length;
                    const term = cfg.matchCase ? termObj.text : termObj.text.toLowerCase();
                    const text = cfg.matchCase ? textForSearch : textForSearch.toLowerCase();
                    const minL = Math.max(1, termLen - k);
                    const maxL = Math.min(textLen, termLen + k);

                    for (let pos = 0; pos < textLen; pos++) {
                        if (pos + minL > textLen) break;
                        let bestDist = k + 1;
                        let bestLen = -1;
                        for (let len = minL; len <= maxL; len++) {
                            if (pos + len > textLen) break;
                            const sub = text.substr(pos, len);
                            const dist = levenshtein(sub, term);
                            if (dist <= k) {
                                if (dist < bestDist) {
                                    bestDist = dist;
                                    bestLen = len;
                                } else if (dist === bestDist) {
                                    if (Math.abs(len - termLen) < Math.abs(bestLen - termLen)) bestLen = len;
                                }
                            }
                        }
                        if (bestLen !== -1) {
                            matches.push({ s: pos, e: pos + bestLen });
                            pos += bestLen - 1; 
                        }
                    }
                } else {
                    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const pattern = effectiveWholeWord ? `\\b${esc(termObj.text)}\\b` : esc(termObj.text);
                    const re = new RegExp(pattern, cfg.matchCase ? 'g' : 'gi');
                    let m;
                    while ((m = re.exec(textForSearch)) !== null) matches.push({ s: m.index, e: re.lastIndex });
                }
            });

            // 为每个匹配创建 Range
            matches.forEach(m => {
                try {
                    const range = document.createRange();
                    range.setStart(node, m.s);
                    range.setEnd(node, m.e);
                    ranges.push(range);
                } catch(e) {
                    // Range 创建失败，跳过
                }
            });
        }

        if (abortSignal.abort || state.searchId !== currentId) {
            state.abortController = null;
            return;
        }
        
        state.ranges = ranges;
        state.abortController = null;
        
        // 应用 CSS Highlight
        if (ranges.length > 0 && CSS.highlights) {
            const highlight = new Highlight(...ranges);
            CSS.highlights.set('sf-search-all', highlight);
        }
        
        loadingInd.style.display = 'none';
        countDisplay.style.opacity = '1';
        
        updateUI();
        if (ranges.length > 0) go(1);
        drawTickBar();
    }

    function drawTickBar() {
        tickBar.innerHTML = '';
        if(!state.ranges.length) { tickBar.style.display='none'; return; }
        tickBar.style.display='block';
        const h = document.documentElement.scrollHeight;
        state.ranges.forEach((range, i) => {
            try {
                const rect = range.getBoundingClientRect();
                const top = window.scrollY + rect.top;
                const pct = (top / h) * 100;
                const isAct = i === state.idx;
                const mark = document.createElement('div');
                mark.style.cssText = `position:absolute; right:0; top:${pct}%; transform:translateY(-50%); pointer-events:none;`;
                if (isAct) {
                    mark.style.borderRight = '10px solid #ff3333';
                    mark.style.borderTop = '6px solid transparent';
                    mark.style.borderBottom = '6px solid transparent';
                    mark.style.zIndex = 999;
                } else {
                    mark.style.width = '10px'; mark.style.height = '4px'; 
                    mark.style.background = CONFIG.colors[0]; mark.style.opacity = 0.8;
                }
                tickBar.appendChild(mark);
            } catch(e) {}
        });
    }

    function go(dir) {
        if (!state.ranges.length) return;
        state.idx = (state.idx + dir + state.ranges.length) % state.ranges.length;
        
        const range = state.ranges[state.idx];
        if (!range) return;
        
        try {
            // 高亮当前项
            CSS.highlights.delete('sf-search-active');
            const activeHighlight = new Highlight(range);
            CSS.highlights.set('sf-search-active', activeHighlight);
            
            // 滚动到视图
            const rect = range.getBoundingClientRect();
            const isHidden = rect.top < 0 || rect.bottom > window.innerHeight;
            toast.classList.toggle('visible', isHidden);
            
            range.startContainer.parentElement.scrollIntoView({block:'center', behavior:'smooth'});
        } catch(e) {}
        
        updateUI();
        drawTickBar();
    }

    function updateUI() {
        countDisplay.textContent = state.ranges.length ? t('count').replace('{i}', state.idx + 1).replace('{total}', state.ranges.length) : '';
    }

    function toggle(force) {
        if (!root) tryInit(); 
        const next = (force !== undefined) ? force : !state.visible;
        state.visible = next;
        
        if (!root) { setTimeout(() => toggle(force), 100); return; }

        root.classList.toggle('show', next);
        
        if (next) {
            checkPageSize(); 
            setTimeout(() => input.focus(), 50);
            updatePlaceholder();
            if (input.value && state.ranges.length === 0 && !CONFIG.search.fuzzy && !state.manualMode) triggerSearch();
        } else {
            if (state.abortController) {
                state.abortController.abort = true;
                state.abortController = null;
            }
            
            // 清理高亮
            if (CSS.highlights) {
                CSS.highlights.clear();
            }
            state.ranges = [];
            tickBar.style.display = 'none';
        }
    }

    // CSS Highlight API 样式
    const globalStyle = document.createElement('style');
    globalStyle.textContent = `
        ::highlight(sf-search-all) {
            background-color: #fce8b2;
            color: #000;
        }
        ::highlight(sf-search-active) {
            background-color: #ff9800 !important;
            color: #000;
        }
    `;
    if (document.head) document.head.appendChild(globalStyle);
    else window.addEventListener('DOMContentLoaded', () => document.head.appendChild(globalStyle));

    function handleKey(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
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
    }

    window.addEventListener('keydown', handleKey, true);
    document.addEventListener('keydown', handleKey, true);

    if (CONFIG.layout.persistent) {
        window.addEventListener('load', () => toggle(true));
    }

    tryInit();

})();
