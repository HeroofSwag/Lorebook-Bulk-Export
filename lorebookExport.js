// ==UserScript==
// @name         Lorebook Bulk Exporter — Moescape / Yodayo / Swerve
// @namespace    lorebook-bulk-export
// @author       etriptow
// @version      2.0.0
// @description  Read-only lorebook backups, Character.AI import JSON, and SillyTavern World Info JSON.
// @match        https://moescape.ai/tavern/lorebooks/*
// @match        https://www.moescape.ai/tavern/lorebooks/*
// @match        https://yodayo.com/tavern/lorebooks/*
// @match        https://www.yodayo.com/tavern/lorebooks/*
// @match        https://swerveai.app/worldbooks/*
// @match        https://www.swerveai.app/worldbooks/*
// @run-at       document-end
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  if (document.getElementById('lorebook-multisite-exporter')) return;

  const site = /(^|\.)swerveai\.app$/i.test(location.hostname)
    ? 'Swerve'
    : /(^|\.)yodayo\.com$/i.test(location.hostname)
      ? 'Yodayo' : 'Moescape';

  const ROOT = '/html/body/main/section/div/div[2]/div/div/div/div';
  const MAIN = ROOT + '[2]';
  const SIDE = ROOT + '[1]';

  const PATH = site === 'Swerve' ? {
    name: '/html/body/div[2]/div/main/main/main/div/header/h1',
    count: '/html/body/div[2]/div/main/main/main/div/h2',
    cards: '/html/body/div[2]/div/main/main/main/div/details'
  } : {
    name: MAIN + '/div[1]/div[1]/h1',

    authors: site === 'Yodayo'
      ? [
          MAIN + '/div[1]/div[2]/a',
          SIDE + '/div[1]/div[2]/div[1]/div/a'
        ]
      : [MAIN + '/div[1]/div[2]/a'],

    image: SIDE + '/div[1]/div[1]/img',
    bookDescription: MAIN + '/div[2]/div[1]/div[1]/div/p',
    bookDescriptionBox: MAIN + '/div[2]/div[1]/div[1]',

    // Yodayo correction: tags are in the center column.
    tags: MAIN + '/div[2]/div[1]/div[2]/div/div',
    tagSection: MAIN + '/div[2]/div[1]/div[2]',
    tagsMore: MAIN + '/div[2]/div[1]/div[2]/div/button',

    count: MAIN + '/div[2]/div[1]/div[3]/p[2]',
    list: MAIN + '/div[2]/div[1]/div[4]',
    detail: MAIN + '/div[2]/div[2]',
    title: MAIN + '/div[2]/div[2]/div/p',
    keyBox: MAIN + '/div[2]/div[2]/div/div[2]/div[3]',

    // Never use a description path inside the activation-key box.
    descriptionNodes: MAIN + '/div[2]/div[2]/div/div[*]/div',

    likes: SIDE + '/div[2]/div[2]/div[1]/p[2]',
    updated: SIDE + '/div[2]/div[2]/div[2]/p[2]',
    created: SIDE + '/div[2]/div[2]/div[3]/p[2]',
    scanDepth: SIDE + '/div[2]/div[2]/div[4]/p[2]',
    recursiveDepth: SIDE + '/div[2]/div[2]/div[5]/p[2]'
  };

  const delay = ms => new Promise(r => setTimeout(r, ms));

  const one = path => document.evaluate(
    path,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;

  const all = path => {
    const result = document.evaluate(
      path,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );

    return Array.from(
      { length: result.snapshotLength },
      (_, i) => result.snapshotItem(i)
    );
  };

  const raw = el => {
    if (!el) return '';

    if (el.matches?.('textarea, input')) {
      return String(el.value ?? '').replace(/\r\n?/g, '\n');
    }

    // textContent is required for closed Swerve details.
    return String(
      el.innerText || el.textContent || ''
    ).replace(/\r\n?/g, '\n');
  };

  const txt = el => raw(el).trim();

  const hiddenText = el => String(
    el?.textContent ?? ''
  ).replace(/\r\n?/g, '\n').trim();

  const firstText = paths =>
    paths.map(p => txt(one(p))).find(Boolean) || '';

  const number = value => {
    const match = String(value ?? '').match(/\d[\d,]*/);

    return match
      ? Number(match[0].replaceAll(',', ''))
      : null;
  };

  const waitUntil = async (test, ms = 4000) => {
    const start = performance.now();

    while (performance.now() - start < ms) {
      if (test()) return true;
      await delay(100);
    }

    return !!test();
  };

  // ------------------------------------------------------------
  // ENTRY COUNT
  // ------------------------------------------------------------

  function entryCount() {
    if (site === 'Swerve') {
      const value = txt(one(PATH.count));

      // Example: "Entries • 9"
      const matches = [...value.matchAll(/\d[\d,]*/g)];

      return matches.length
        ? Number(matches.at(-1)[0].replaceAll(',', ''))
        : null;
    }

    const value = txt(one(PATH.count));

    const match = value.match(
      /([\d,]+)\s+entr(?:y|ies)/i
    );

    return match
      ? Number(match[1].replaceAll(',', ''))
      : null;
  }

  // ------------------------------------------------------------
  // MOESCAPE / YODAYO ENTRY LIST
  // ------------------------------------------------------------

  function listRows() {
    const list = one(PATH.list);

    if (!list) return [];

    return [...list.children].map((row, index) => {
      const p = row.querySelector(
        ':scope > div:first-child > p'
      );

      const title = txt(p);

      if (!p || !title) return null;

      if (/^(?:entries?|new entry|add entry|create entry|load more|show more)$/i.test(title)) {
        return null;
      }

      if (
        row.querySelector(':scope > button') &&
        !row.querySelector(':scope > div > p')
      ) {
        return null;
      }

      return { index, title };
    }).filter(Boolean);
  }

  function moreEntriesButton() {
    const list = one(PATH.list);

    if (!list) return null;

    const candidates = [...list.children]
      .filter(row =>
        !row.querySelector(':scope > div:first-child > p')
      )
      .flatMap(row => [
        ...row.querySelectorAll(':scope > button')
      ]);

    const enabled = candidates.filter(b =>
      !b.disabled &&
      b.getAttribute('aria-disabled') !== 'true'
    );

    return enabled.find(b =>
      /load\s*more|show\s*more|more\s*entries/i.test(
        [
          txt(b),
          b.getAttribute('aria-label'),
          b.title
        ].join(' ')
      )
    ) || enabled.at(-1) || null;
  }

  // ------------------------------------------------------------
  // LOREBOOK METADATA
  // ------------------------------------------------------------

  function bookInfo() {
    if (site === 'Swerve') {
      return {
        name: txt(one(PATH.name)),
        author: '',
        imageUrl: '',
        description: '',
        descriptionParagraphs: [],
        tags: [],
        likes: '',
        updated: '',
        created: '',
        scanDepth: null,
        recursiveDepth: null
      };
    }

    const image = one(PATH.image);

    const src =
      image?.currentSrc ||
      image?.getAttribute('src') ||
      image?.getAttribute('data-src') ||
      '';

    let imageUrl = '';

    try {
      if (src) {
        imageUrl = new URL(src, location.href).href;
      }
    } catch (_) {
      imageUrl = src;
    }

    const paragraphs = all(PATH.bookDescription)
      .map(txt)
      .filter(Boolean);

    return {
      name: txt(one(PATH.name)),

      author: firstText(PATH.authors)
        .replace(/^by\s+/i, ''),

      imageUrl,

      description: paragraphs.join('\n\n'),
      descriptionParagraphs: paragraphs,

      tags: [
        ...new Set(
          all(PATH.tags)
            .map(txt)
            .filter(Boolean)
            .filter(t => !/^\+\d+$/.test(t))
        )
      ],

      likes: txt(one(PATH.likes)),
      updated: txt(one(PATH.updated)),
      created: txt(one(PATH.created)),

      scanDepth: number(
        txt(one(PATH.scanDepth))
      ),

      recursiveDepth: number(
        txt(one(PATH.recursiveDepth))
      )
    };
  }

  async function expandBookInfo() {
    if (site === 'Swerve') return;

    const desc = one(PATH.bookDescriptionBox);

    const expandDesc = [
      ...(desc?.querySelectorAll('button') || [])
    ].find(b =>
      /show more|read more/i.test(txt(b))
    );

    if (expandDesc) {
      expandDesc.click();
      await delay(150);
    }

    for (let i = 0; i < 8 && !stopped; i++) {
      const section = one(PATH.tagSection);

      const buttons = [
        one(PATH.tagsMore),
        ...(section?.querySelectorAll('button') || [])
      ].filter(Boolean);

      const more = buttons.find(b =>
        !b.disabled &&
        (
          /show more|load more|\+\d+|more tags/i.test(txt(b)) ||
          /show more/i.test(b.title || '')
        )
      );

      if (!more) break;

      const before = all(PATH.tags).length;

      more.click();
      await delay(180);

      if (all(PATH.tags).length <= before) {
        break;
      }
    }
  }

  // ------------------------------------------------------------
  // MOESCAPE / YODAYO DESCRIPTION EXTRACTION
  // ------------------------------------------------------------

  function detailDescription() {
    const panel = one(PATH.detail);
    const keyBox = one(PATH.keyBox);

    if (!panel) {
      return {
        value: '',
        found: false
      };
    }

    const outsideKeys = node =>
      !keyBox || (
        !node.contains(keyBox) &&
        !keyBox.contains(node)
      );

    const nodes = all(PATH.descriptionNodes)
      .filter(n =>
        n instanceof HTMLElement &&
        outsideKeys(n)
      );

    for (const editor of panel.querySelectorAll(
      'textarea, [contenteditable="true"], .ProseMirror'
    )) {
      if (
        outsideKeys(editor) &&
        !nodes.some(n =>
          n === editor || n.contains(editor)
        )
      ) {
        nodes.push(editor);
      }
    }

    const ranked = nodes.map(node => {
      const editor = node.matches(
        'textarea, [contenteditable="true"], .ProseMirror'
      )
        ? node
        : node.querySelector(
            'textarea, [contenteditable="true"], .ProseMirror'
          );

      const target = editor || node;
      const value = raw(target);

      let score =
        value.trim().length +
        (editor ? 100000 : 0);

      if (/^(description|activation keys|content)$/i.test(value.trim())) {
        score -= 50000;
      }

      return { value, score };
    })
      .filter(x => x.value.trim())
      .sort((a, b) => b.score - a.score);

    return {
      value: ranked[0]?.value ?? '',
      found: !!ranked.length
    };
  }

  function detailKeys() {
    const root = one(PATH.keyBox);

    if (!root) {
      return {
        values: [],
        found: false
      };
    }

    const values = [];

    for (const chip of root.children) {
      if (
        chip.matches('input, textarea') ||
        chip.querySelector('input, textarea')
      ) {
        continue;
      }

      const clone = chip.cloneNode(true);

      clone.querySelectorAll(
        'svg,button,input,textarea,' +
        '[aria-label*="remove" i],' +
        '[title*="remove" i],' +
        '[aria-label*="delete" i]'
      ).forEach(n => n.remove());

      const value = txt(clone)
        .replace(/^[×✕]\s*|\s*[×✕]$/g, '')
        .trim();

      if (
        value &&
        !/^(add|add key|add keyword|new keyword|\+)$/i.test(value)
      ) {
        values.push(value);
      }
    }

    return {
      values,
      found: true
    };
  }

  // ------------------------------------------------------------
  // COMMON ENTRY STRUCTURE
  // ------------------------------------------------------------

  function packEntry(title, description, keys, ordinal) {
    return {
      index: ordinal + 1,
      title,
      description,
      activationKeys: keys,
      descriptionChars: description.length,
      activationKeysChars: keys.join(', ').length
    };
  }

  function currentEntry(fallback, ordinal) {
    const desc = detailDescription();
    const keys = detailKeys();

    return {
      entry: packEntry(
        txt(one(PATH.title)) || fallback,
        desc.value,
        keys.values,
        ordinal
      ),

      foundDescription: desc.found,
      foundKeys: keys.found
    };
  }

  // ------------------------------------------------------------
  // SWERVE EXTRACTION
  // ------------------------------------------------------------

  async function swerveCards() {
    const nodes = all(PATH.cards);

    return nodes.filter(n =>
      n instanceof HTMLDetailsElement
    );
  }

  async function scanSwerve(total) {
    const cards = await swerveCards();

    if (cards.length !== total) {
      throw new Error(
        `Swerve shows ${total} entries, but ` +
        `${cards.length} <details> cards were found.`
      );
    }

    for (let i = 0; i < cards.length; i++) {
      if (stopped) {
        throw new Error('Stopped; partial audit only.');
      }

      const card = cards[i];

      const title = hiddenText(
        card.querySelector(':scope > summary')
      );

      let paragraphs = [
        ...card.querySelectorAll(':scope > p')
      ];

      let toggled = false;

      if (paragraphs.length < 2 && !card.open) {
        card.querySelector('summary')?.click();

        toggled = true;

        await delay(150);

        paragraphs = [
          ...card.querySelectorAll(':scope > p')
        ];
      }

      const description = hiddenText(
        paragraphs[0]
      );

      const keys = hiddenText(
        paragraphs[1]
      )
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);

      if (toggled) {
        card.querySelector('summary')?.click();
      }

      const entry = packEntry(
        title,
        description,
        keys,
        i
      );

      validateEntry(
        entry,
        !!paragraphs[0],
        !!paragraphs[1]
      );

      entries.push(entry);

      status(
        `Extracting Swerve: ${entries.length} / ${total}\n` +
        `Latest: ${title}`
      );
    }
  }

  // ------------------------------------------------------------
  // MOESCAPE / YODAYO PAGINATION
  // ------------------------------------------------------------

  async function preloadPaged(total) {
    // Never look for Load more when total <= 25.
    if (total <= 25) {
      status(
        `Small lorebook (${total} entries).\n` +
        'Skipping Load more.'
      );

      await waitUntil(
        () => listRows().length >= total,
        5000
      );

      if (listRows().length !== total) {
        throw new Error(
          `List row mismatch: ${listRows().length}/${total}. ` +
          'No pagination attempted.'
        );
      }

      return;
    }

    const maxClicks =
      Math.ceil(total / 25) + 20;

    for (
      let clicks = 0;
      clicks < maxClicks && !stopped;
      clicks++
    ) {
      const loaded = listRows().length;

      status(
        `Loading entries: ${loaded} / ${total}`
      );

      if (loaded === total) return;

      if (loaded > total) {
        throw new Error(
          `Too many title rows (${loaded}/${total}).`
        );
      }

      let button = moreEntriesButton();

      if (!button) {
        await waitUntil(
          () =>
            !!moreEntriesButton() ||
            listRows().length > loaded,
          3500
        );

        if (listRows().length > loaded) {
          continue;
        }

        button = moreEntriesButton();
      }

      if (!button) {
        throw new Error(
          `No Load more button at ${loaded}/${total}. ` +
          'Scan not started.'
        );
      }

      button.scrollIntoView({
        block: 'center',
        behavior: 'instant'
      });

      button.click();

      if (!await waitUntil(
        () => listRows().length > loaded,
        7000
      )) {
        throw new Error(
          `Load more did not add rows at ${loaded}/${total}.`
        );
      }
    }

    if (stopped) {
      throw new Error('Stopped during preload.');
    }

    if (listRows().length !== total) {
      throw new Error(
        `Only ${listRows().length}/${total} entries loaded.`
      );
    }
  }

  async function scanPaged(total) {
    await preloadPaged(total);
    await expandBookInfo();

    metadata = bookInfo();

    const initial = listRows();

    if (initial.length !== total) {
      throw new Error(
        `List changed during metadata expansion ` +
        `(${initial.length}/${total}).`
      );
    }

    const duplicateTitles = new Set();
    const titlesSeen = new Set();

    for (const row of initial) {
      if (titlesSeen.has(row.title)) {
        duplicateTitles.add(row.title);
      }

      titlesSeen.add(row.title);
    }

    if (duplicateTitles.size) {
      warning(
        'Duplicate titles require spot-checking: ' +
        [...duplicateTitles].slice(0, 10).join(', ')
      );
    }

    for (let i = 0; i < initial.length; i++) {
      if (stopped) {
        throw new Error('Stopped; partial audit only.');
      }

      const rowInfo = initial[i];

      const row = one(PATH.list)
        ?.children[rowInfo.index];

      if (!row) {
        warning(
          `Missing row #${i + 1}: ${rowInfo.title}`
        );

        continue;
      }

      const target =
        row.querySelector(':scope > div:first-child') ||
        row;

      target.click();

      if (!await waitUntil(
        () => txt(one(PATH.title)) === rowInfo.title,
        3000
      )) {
        warning(
          `Cannot select #${i + 1}: ${rowInfo.title}`
        );

        continue;
      }

      // Allow content and keywords to rerender after title.
      await delay(200);

      const record = currentEntry(
        rowInfo.title,
        i
      );

      validateEntry(
        record.entry,
        record.foundDescription,
        record.foundKeys
      );

      if (record.entry.title !== rowInfo.title) {
        warning(
          `Title changed at #${i + 1}.`
        );
      }

      entries.push(record.entry);

      status(
        `Extracting ${site}: ${entries.length} / ${total}\n` +
        `Latest: ${record.entry.title}`
      );
    }
  }

  // ------------------------------------------------------------
  // FLOATING EXPORT PANEL
  // ------------------------------------------------------------

  const host = document.createElement('div');

  host.id = 'lorebook-multisite-exporter';

  host.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;';

  document.body.appendChild(host);

  const shadow = host.attachShadow({
    mode: 'open'
  });

  shadow.innerHTML = `
    <style>
      * {
        box-sizing: border-box;
      }

      .panel {
        width: 380px;
        max-width: calc(100vw - 20px);
        border-radius: 12px;
        padding: 13px;
        color: #f1f5f9;
        background: #17202e;
        border: 1px solid #64748b;
        box-shadow: 0 8px 35px #0009;
        font: 13px/1.5 system-ui,Segoe UI,sans-serif;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .header strong {
        font-size: 14px;
      }

      .muted {
        color: #cbd5e1;
      }

      .body {
        margin-top: 8px;
      }

      .panel.min .body {
        display: none;
      }

      label {
        display: block;
        margin-top: 8px;
        margin-bottom: 3px;
        color: #cbd5e1;
      }

      input:not([type=checkbox]), select {
        width: 100%;
        background: #0f172a;
        border: 1px solid #64748b;
        color: white;
        border-radius: 6px;
        padding: 7px;
        font: inherit;
      }

      .buttons {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
        margin-top: 9px;
      }

      button {
        background: #334155;
        border: 1px solid #64748b;
        color: white;
        border-radius: 6px;
        padding: 7px 9px;
        cursor: pointer;
        font: inherit;
      }

      button.primary {
        background: #0f766e;
        border-color: #14b8a6;
        font-weight: 700;
      }

      button:disabled {
        opacity: .4;
        cursor: not-allowed;
      }

      #status, #warnings {
        white-space: pre-wrap;
        max-height: 115px;
        overflow: auto;
        margin-top: 8px;
        font-size: 12px;
      }

      #status {
        color: #a7f3d0;
      }

      #warnings {
        color: #fbbf24;
      }

      #toggle {
        padding: 1px 8px;
        min-width: 29px;
        font-size: 18px;
      }
    </style>

    <section class="panel" id="panel">
      <div class="header">
        <strong>
          Multisite Lorebook Exporter
          <span id="count" class="muted"></span>
        </strong>

        <button
          id="toggle"
          title="Minimize/restore"
        >−</button>
      </div>

      <div class="body">
        <div class="muted">
          Site: <b id="siteName"></b> · Read-only
        </div>

        <label
          for="bookName"
          title="Detected from lorebook heading. Editing changes the downloaded filename only."
        >Lorebook name ⓘ</label>

        <input
          id="bookName"
          type="text"
          placeholder="Detecting lorebook title..."
        />

        <div class="buttons">
          <button
            id="preview"
            title="Preview first Swerve card or selected Moescape/Yodayo entry"
          >Preview</button>

          <button
            id="scan"
            class="primary"
            title="Extract all entries and validate against displayed count"
          >Scan all entries</button>

          <button id="stop" disabled>Stop</button>
        </div>

        <label
          for="format"
          title="JSON includes all available metadata. Import JSON and SillyTavern JSON are for importing elsewhere."
        >Download format ⓘ</label>

        <select id="format">
          <option value="JSON">
            JSON (full audit)
          </option>
          <option value="JSONL">JSONL</option>
          <option value="CSV">CSV</option>
          <option value="TXT">TXT</option>
          <option value="XML">XML</option>
          <option value="IMPORT_JSON">
            Import JSON (Character.AI-compatible)
          </option>
          <option value="SILLYTAVERN_JSON">
            SillyTavern JSON (World Info)
          </option>
        </select>

        <label
          id="limitLabel"
          style="display:none"
          title="Character.AI allows at most eight keys per entry. Unchecked preserves all keys."
        >
          <input id="limitKeys" type="checkbox" />
          Limit to 8 keys (Character.AI strict mode)
        </label>

        <div class="buttons">
          <button
            id="download"
            class="primary"
            disabled
          >Download export</button>
        </div>

        <div id="status">
          Ready. Preview an entry or scan the lorebook.
        </div>

        <div id="warnings"></div>
      </div>
    </section>
  `;

  const $ = id => shadow.getElementById(id);

  let entries = [];
  let metadata = {};
  let expected = null;
  let warnings = [];

  let busy = false;
  let stopped = false;
  let complete = false;
  let started = '';
  let filenameEdited = false;

  $('siteName').textContent = site;

  const status = value => {
    $('status').textContent = value;
  };

  function warning(message) {
    warnings.push(message);

    $('warnings').textContent =
      warnings.slice(-6).join('\n');

    console.warn(
      '[Lorebook Export]',
      message
    );
  }

  function validateEntry(entry, descFound, keysFound) {
    if (!entry.title) {
      warning(
        `Entry #${entry.index}: missing title.`
      );
    }

    if (!descFound || !entry.description.trim()) {
      warning(
        `${entry.title}: description missing/empty.`
      );
    }

    if (!keysFound) {
      warning(
        `${entry.title}: key container missing.`
      );
    }

    if (!entry.activationKeys.length) {
      warning(
        `${entry.title}: zero activation keys.`
      );
    }

    if (entry.descriptionChars > 4096) {
      warning(
        `${entry.title}: description ` +
        `${entry.descriptionChars}/4096 characters.`
      );
    }

    if (entry.activationKeysChars > 1024) {
      warning(
        `${entry.title}: keys ` +
        `${entry.activationKeysChars}/1024 characters.`
      );
    }
  }

  // ------------------------------------------------------------
  // PANEL CONTROLS
  // ------------------------------------------------------------

  function refresh() {
    const name = txt(one(PATH.name));

    if (name && !filenameEdited) {
      $('bookName').value = name;
    }

    const count = entryCount();

    $('count').textContent = count === null
      ? '(count unavailable)'
      : `(${count} entries)`;

    return { name, count };
  }

  $('bookName').addEventListener('input', () => {
    filenameEdited = true;
  });

  $('format').onchange = () => {
    $('limitLabel').style.display =
      $('format').value === 'IMPORT_JSON'
        ? 'block'
        : 'none';
  };

  $('toggle').onclick = () => {
    const minimized =
      $('panel').classList.toggle('min');

    $('toggle').textContent =
      minimized ? '+' : '−';
  };

  $('stop').onclick = () => {
    stopped = true;
    status('Stopping...');
  };

  refresh();

  let refreshTries = 0;

  const poll = setInterval(() => {
    const info = refresh();

    if (
      (info.name && info.count !== null) ||
      ++refreshTries > 40
    ) {
      clearInterval(poll);
    }
  }, 450);

  $('preview').onclick = async () => {
    const info = refresh();

    if (site === 'Swerve') {
      const cards = await swerveCards();

      const card =
        cards.find(d => d.open) ||
        cards[0];

      const paragraphs = card
        ? [...card.querySelectorAll(':scope > p')]
        : [];

      status(
        `Lorebook: ${info.name}\n` +
        `Cards: ${cards.length}/${info.count ?? '?'}\n` +
        `Example: ${hiddenText(card?.querySelector('summary'))}\n` +
        `Description: ${hiddenText(paragraphs[0]).length} chars · ` +
        `Keys: ${hiddenText(paragraphs[1]).split(',').filter(Boolean).length}`
      );

      console.log(
        '[Lorebook Export] Swerve preview',
        card,
        paragraphs
      );
    } else {
      const record = currentEntry('', 0);

      status(
        `Lorebook: ${info.name}\n` +
        `Selected: ${record.entry.title}\n` +
        `Description: ${record.entry.descriptionChars} chars · ` +
        `Keys: ${record.entry.activationKeys.length}\n` +
        `Description node: ${record.foundDescription} · ` +
        `Keys node: ${record.foundKeys}`
      );

      console.log(
        '[Lorebook Export] Preview',
        record
      );
    }
  };

  // ------------------------------------------------------------
  // SCAN
  // ------------------------------------------------------------

  $('scan').onclick = async () => {
    if (busy) return;

    busy = true;
    stopped = false;
    complete = false;

    entries = [];
    metadata = {};
    warnings = [];

    started = new Date().toISOString();

    $('warnings').textContent = '';

    $('preview').disabled = true;
    $('scan').disabled = true;
    $('stop').disabled = false;
    $('download').disabled = true;

    const scroller =
      site !== 'Swerve' && one(PATH.list)
        ? (() => {
            for (
              let node = one(PATH.list);
              node && node !== document.body;
              node = node.parentElement
            ) {
              const css = getComputedStyle(node);

              if (
                /(auto|scroll)/.test(css.overflowY) &&
                node.scrollHeight > node.clientHeight + 8
              ) {
                return node;
              }
            }

            return null;
          })()
        : null;

    const priorScroll = scroller
      ? scroller.scrollTop
      : window.scrollY;

    try {
      const info = refresh();

      expected = info.count;

      if (!info.name) {
        throw new Error(
          'Lorebook name XPath not found.'
        );
      }

      if (
        !Number.isSafeInteger(expected) ||
        expected < 1
      ) {
        throw new Error(
          'Lorebook count XPath not found.'
        );
      }

      metadata = bookInfo();

      if (site === 'Swerve') {
        await scanSwerve(expected);
      } else {
        await scanPaged(expected);
      }

      complete =
        !stopped &&
        entries.length === expected &&
        entries.every(e =>
          e.title && e.description.trim()
        );

      if (entries.length !== expected) {
        warning(
          `Count mismatch: ${entries.length}/${expected}.`
        );
      }

      status(
        `${complete ? 'SCAN COMPLETE' : 'SCAN INCOMPLETE'}\n` +
        `Exported: ${entries.length} / ${expected}\n` +
        `Warnings: ${warnings.length}\n` +
        'Review the audit JSON before replacing any lorebook.'
      );

    } catch (error) {
      warning(
        String(error?.message || error)
      );

      status(
        `SCAN INCOMPLETE · ${entries.length}/${expected ?? '?'}\n` +
        `Reason: ${error?.message || error}\n` +
        'Partial audit formats available when entries exist.'
      );

    } finally {
      if (scroller) {
        scroller.scrollTop = priorScroll;
      } else {
        window.scrollTo(0, priorScroll);
      }

      busy = false;

      $('preview').disabled = false;
      $('scan').disabled = false;
      $('stop').disabled = true;

      $('download').disabled =
        entries.length === 0;
    }
  };

  // ------------------------------------------------------------
  // FILENAME / AUDIT STRUCTURE
  // ------------------------------------------------------------

  const pad = n =>
    String(n).padStart(2, '0');

  const stamp = () => {
    const d = new Date();

    return (
      `${d.getFullYear()}` +
      `${pad(d.getMonth() + 1)}` +
      `${pad(d.getDate())}_` +
      `${pad(d.getHours())}` +
      `${pad(d.getMinutes())}` +
      `${pad(d.getSeconds())}`
    );
  };

  const safe = value =>
    String(value || 'Lorebook')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._ ]+|[._ ]+$/g, '')
      .slice(0, 120) || 'Lorebook';

  const audit = () => ({
    format: 'multi-site-lorebook-audit-v2',
    sourceSite: site,
    sourceUrl: location.href,
    metadata,
    expectedEntryCount: expected,
    exportedEntryCount: entries.length,
    complete,
    scanStartedAt: started,
    exportedAt: new Date().toISOString(),
    warnings,
    entries
  });

  const escCSV = value =>
    '"' +
    String(value ?? '').replace(/"/g, '""') +
    '"';

  const escXML = value =>
    String(value ?? '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  // ------------------------------------------------------------
  // CHARACTER.AI-COMPATIBLE JSON
  // ------------------------------------------------------------

  function characterAI(data, limit) {
    const result = {
      entries: {}
    };

    data.entries.forEach((entry, i) => {
      result.entries[String(i)] = {
        comment: entry.title,

        key: limit
          ? entry.activationKeys.slice(0, 8)
          : entry.activationKeys,

        content: entry.description
      };
    });

    return result;
  }

  // ------------------------------------------------------------
  // SILLYTAVERN WORLD INFO JSON
  // ------------------------------------------------------------

  function sillyTavern(data) {
    const sourceScan =
      data.metadata.scanDepth;

    const sourceRecursive =
      data.metadata.recursiveDepth;

    const scanDepth =
      Number.isSafeInteger(sourceScan)
        ? sourceScan
        : 4;

    const recursiveScanning =
      Number.isSafeInteger(sourceRecursive)
        ? sourceRecursive > 0
        : true;

    const entriesObj = {};

    data.entries.forEach((entry, uid) => {
      entriesObj[String(uid)] = {
        uid,

        key: entry.activationKeys,
        keysecondary: [],
        comment: entry.title,
        content: entry.description,

        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,

        order: 100,
        position: 0,
        disable: false,
        ignoreBudget: false,

        excludeRecursion: false,
        preventRecursion: false,

        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,

        delayUntilRecursion: false,

        probability: 100,
        useProbability: false,
        depth: 4,

        outletName: '',
        group: 'default',
        groupOverride: false,
        groupWeight: 100,

        scanDepth: null,
        caseSensitive: false,
        matchWholeWords: false,
        useGroupScoring: null,

        automationId: '',
        role: 0,

        sticky: 0,
        cooldown: 0,
        delay: 0,

        triggers: [],
        displayIndex: uid
      };
    });

    return {
      entries: entriesObj,

      name:
        data.metadata.name ||
        'Lorebook',

      description:
        data.metadata.description ||
        '',

      scanDepth,
      tokenBudget: 512,
      recursiveScanning,

      extensions: {}
    };
  }

  // ------------------------------------------------------------
  // SERIALIZATION
  // ------------------------------------------------------------

  function serialize(format, data) {
    if (format === 'JSON') {
      return JSON.stringify(
        data,
        null,
        2
      );
    }

    if (format === 'IMPORT_JSON') {
      return JSON.stringify(
        characterAI(
          data,
          $('limitKeys').checked
        ),
        null,
        2
      );
    }

    if (format === 'SILLYTAVERN_JSON') {
      return JSON.stringify(
        sillyTavern(data),
        null,
        2
      );
    }

    if (format === 'JSONL') {
      return [
        JSON.stringify({
          recordType: 'lorebook',

          ...Object.fromEntries(
            Object.entries(data)
              .filter(([key]) =>
                key !== 'entries'
              )
          )
        }),

        ...data.entries.map(entry =>
          JSON.stringify({
            recordType: 'entry',
            ...entry
          })
        )
      ].join('\n') + '\n';
    }

    if (format === 'CSV') {
      const fields = [
        'recordType',
        'index',
        'title',
        'description',
        'activationKeys',
        'descriptionChars',
        'activationKeysChars',
        'sourceSite',
        'name',
        'author',
        'imageUrl',
        'bookDescription',
        'tags',
        'likes',
        'updated',
        'created',
        'scanDepth',
        'recursiveDepth',
        'expectedEntryCount',
        'complete'
      ];

      const rows = [
        {
          recordType: 'lorebook',
          sourceSite: data.sourceSite,

          name: data.metadata.name,
          author: data.metadata.author,
          imageUrl: data.metadata.imageUrl,

          bookDescription:
            data.metadata.description,

          tags: JSON.stringify(
            data.metadata.tags
          ),

          likes: data.metadata.likes,
          updated: data.metadata.updated,
          created: data.metadata.created,

          scanDepth:
            data.metadata.scanDepth,

          recursiveDepth:
            data.metadata.recursiveDepth,

          expectedEntryCount:
            data.expectedEntryCount,

          complete: data.complete
        },

        ...data.entries.map(entry => ({
          recordType: 'entry',

          ...entry,

          activationKeys: JSON.stringify(
            entry.activationKeys
          )
        }))
      ];

      return [
        fields.map(escCSV).join(','),

        ...rows.map(row =>
          fields.map(field =>
            escCSV(row[field])
          ).join(',')
        )
      ].join('\r\n');
    }

    if (format === 'TXT') {
      return [
        `LOREBOOK: ${data.metadata.name}`,
        `SITE: ${data.sourceSite}`,
        `AUTHOR: ${data.metadata.author}`,

        `DESCRIPTION:\n${data.metadata.description}`,
        `IMAGE: ${data.metadata.imageUrl}`,
        `TAGS: ${data.metadata.tags.join(', ')}`,

        `LIKES: ${data.metadata.likes}`,
        `UPDATED: ${data.metadata.updated}`,
        `CREATED: ${data.metadata.created}`,

        `SCAN DEPTH: ${data.metadata.scanDepth ?? ''}`,
        `RECURSIVE DEPTH: ${data.metadata.recursiveDepth ?? ''}`,

        `EXPORTED: ${data.exportedEntryCount}/${data.expectedEntryCount}`,
        `COMPLETE: ${data.complete}`,
        `WARNINGS: ${data.warnings.join(' | ')}`,

        ...data.entries.map(entry =>
          '\n' +
          '='.repeat(55) +
          '\n' +

          `ENTRY ${entry.index}: ${entry.title}\n` +
          `DESCRIPTION:\n${entry.description}\n` +
          `ACTIVATION KEYS:\n${entry.activationKeys.join(', ')}`
        )
      ].join('\n') + '\n';
    }

    if (format === 'XML') {
      const tag = (key, value) =>
        `<${key}>${escXML(value)}</${key}>`;

      const meta = data.metadata;

      return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +

        `<lorebook complete="${data.complete}" ` +
        `count="${data.exportedEntryCount}">\n` +

        '<metadata>' +

        [
          'name',
          'author',
          'imageUrl',
          'description',
          'likes',
          'updated',
          'created',
          'scanDepth',
          'recursiveDepth'
        ].map(key =>
          tag(key, meta[key] ?? '')
        ).join('') +

        '<tags>' +

        meta.tags.map(value =>
          tag('tag', value)
        ).join('') +

        '</tags></metadata>\n' +

        '<entries>' +

        data.entries.map(entry =>
          `<entry index="${entry.index}">` +

          tag('title', entry.title) +
          tag('description', entry.description) +

          '<activationKeys>' +

          entry.activationKeys.map(key =>
            tag('key', key)
          ).join('') +

          '</activationKeys></entry>'
        ).join('\n') +

        '</entries></lorebook>'
      );
    }

    throw new Error(
      `Unsupported export: ${format}`
    );
  }

  // ------------------------------------------------------------
  // DOWNLOAD
  // ------------------------------------------------------------

  $('download').onclick = () => {
    if (!entries.length) return;

    const format = $('format').value;

    const isImport =
      format === 'IMPORT_JSON' ||
      format === 'SILLYTAVERN_JSON';

    if (isImport && !complete) {
      warning(
        `${format} blocked: incomplete scan; ` +
        'download JSON audit instead.'
      );

      return;
    }

    if (
      format === 'IMPORT_JSON' &&
      $('limitKeys').checked
    ) {
      const omitted = entries.reduce(
        (count, entry) =>
          count +
          Math.max(
            0,
            entry.activationKeys.length - 8
          ),
        0
      );

      if (
        omitted &&
        !confirm(
          `Strict Character.AI export omits ` +
          `${omitted} keywords. Continue?`
        )
      ) {
        return;
      }
    }

    const content = serialize(
      format,
      audit()
    );

    const extension = [
      'JSON',
      'IMPORT_JSON',
      'SILLYTAVERN_JSON'
    ].includes(format)
      ? 'json'
      : format.toLowerCase();

    const mime =
      extension === 'json'
        ? 'application/json'
        : extension === 'xml'
          ? 'application/xml'
          : extension === 'csv'
            ? 'text/csv'
            : 'text/plain';

    const blob = new Blob(
      [content],
      {
        type: mime + ';charset=utf-8'
      }
    );

    const filename =
      `${safe($('bookName').value || metadata.name)}_` +
      `${format}_` +
      `${stamp()}.` +
      extension;

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();
    link.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      10000
    );
  };

  console.info(
    `[Lorebook Export] v2 ready for ${site}; ` +
    'local read-only extraction.'
  );
})();
