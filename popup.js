const dictSearch = document.getElementById('dict-search');
const toggleEl = document.getElementById('toggle-enabled');
const toggleLabel = document.getElementById('toggle-label');
const wordList = document.getElementById('word-list');
const inputOriginal = document.getElementById('input-original');
const inputReplacement = document.getElementById('input-replacement');
const btnAdd = document.getElementById('btn-add');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const fileImport = document.getElementById('file-import');
const btnBatchAdd = document.getElementById('btn-batch-add');
const btnBatchDelete = document.getElementById('btn-batch-delete');
const batchInput = document.getElementById('batch-input');
const syncToExternal = document.getElementById('sync-to-external');
const errorMsg = document.getElementById('error-msg');
const BUILT_IN_DICT = window.SHEWORDS_BUILT_IN_DICT || {};
const SESSION_WORDS_KEY = 'sessionWords';
const SESSION_RECORDS_KEY = 'sessionWordRecords';
const PERSISTENT_RECORDS_KEY = 'customWordRecords';
const HAS_SESSION_STORAGE = Boolean(chrome.storage && chrome.storage.session && chrome.storage.session.get);
let latestPersistentWords = {};
let latestSessionWords = {};
let latestPersistentRecords = {};
let latestSessionRecords = {};

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderWordList(persistentRecords, sessionRecords, blockedBuiltIn) {
  const blocked = new Set(blockedBuiltIn || []);
  const scopedEntries = [];

  Object.entries(BUILT_IN_DICT).forEach(([orig, repl]) => {
    if (!blocked.has(orig)) {
      scopedEntries.push({ orig, repl, scope: 'builtin' });
    }
  });
  Object.entries(persistentRecords).forEach(([orig, repl]) => {
    scopedEntries.push({ orig, repl, scope: 'persistent' });
  });
  Object.entries(sessionRecords).forEach(([orig, repl]) => {
    scopedEntries.push({ orig, repl, scope: 'session' });
  });

  const isEnglish = s => /^[a-zA-Z]/.test(s);
  const entries = scopedEntries.sort((a, b) => {
    const aEn = isEnglish(a.orig);
    const bEn = isEnglish(b.orig);
    if (aEn !== bEn) return aEn ? -1 : 1;
    return b.orig.localeCompare(a.orig, aEn ? 'en' : 'zh-Hans-CN');
  });

  const keyword = (dictSearch.value || '').trim().toLowerCase();
  const filteredEntries = keyword
    ? entries.filter(({ orig, repl }) =>
        orig.toLowerCase().includes(keyword) || repl.toLowerCase().includes(keyword))
    : entries;

  if (filteredEntries.length === 0) {
    wordList.innerHTML = '<div class="empty-hint">暂无自定义词汇</div>';
    return;
  }
  const badgeLabel = { builtin: '内置', persistent: '已同步', session: '仅会话' };
  wordList.innerHTML = filteredEntries.map(({ orig, repl, scope }) => `
    <div class="word-item" data-key="${esc(orig)}" data-scope="${scope}">
      <span class="word-pair">
        ${esc(orig)}<span class="arrow">→</span><span class="replacement">${esc(repl)}</span><span class="scope-badge scope-${scope}">${badgeLabel[scope]}</span>
      </span>
      <button class="btn-delete" data-key="${esc(orig)}" data-scope="${scope}" title="删除">×</button>
    </div>
  `).join('');
}

function setToggleUI(enabled) {
  toggleEl.checked = enabled;
  toggleLabel.textContent = enabled ? '开启中' : '已关闭';
}

function updateMergedDictionary(persistentWords, sessionWords, blockedBuiltIn) {
  const blocked = new Set(blockedBuiltIn || []);
  const filteredBuiltIn = Object.fromEntries(
    Object.entries(BUILT_IN_DICT).filter(([k]) => !blocked.has(k))
  );
  const mergedDictionary = Object.assign({}, filteredBuiltIn, persistentWords, sessionWords);
  chrome.storage.local.set({ mergedDictionary });
}

function exportExternalDictionary(persistentWords) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    words: persistentWords
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'shewords-external-dictionary.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getPersistentWords() {
  return new Promise(resolve => {
    chrome.storage.local.get({ customWords: {} }, data => resolve(data.customWords || {}));
  });
}

function getPersistentRecords() {
  return new Promise(resolve => {
    chrome.storage.local.get({ [PERSISTENT_RECORDS_KEY]: {} }, data => resolve(data[PERSISTENT_RECORDS_KEY] || {}));
  });
}

function getSessionWords() {
  return new Promise(resolve => {
    if (!HAS_SESSION_STORAGE) {
      chrome.storage.local.get({ [SESSION_WORDS_KEY]: {} }, data => resolve(data[SESSION_WORDS_KEY] || {}));
      return;
    }
    chrome.storage.session.get({ [SESSION_WORDS_KEY]: {} }, data => resolve(data[SESSION_WORDS_KEY] || {}));
  });
}

function getSessionRecords() {
  return new Promise(resolve => {
    if (!HAS_SESSION_STORAGE) {
      chrome.storage.local.get({ [SESSION_RECORDS_KEY]: {} }, data => resolve(data[SESSION_RECORDS_KEY] || {}));
      return;
    }
    chrome.storage.session.get({ [SESSION_RECORDS_KEY]: {} }, data => resolve(data[SESSION_RECORDS_KEY] || {}));
  });
}

function setSessionWords(words, callback) {
  if (!HAS_SESSION_STORAGE) {
    chrome.storage.local.set({ [SESSION_WORDS_KEY]: words }, callback);
    return;
  }
  chrome.storage.session.set({ [SESSION_WORDS_KEY]: words }, callback);
}

function setSessionRecords(records, callback) {
  if (!HAS_SESSION_STORAGE) {
    chrome.storage.local.set({ [SESSION_RECORDS_KEY]: records }, callback);
    return;
  }
  chrome.storage.session.set({ [SESSION_RECORDS_KEY]: records }, callback);
}

function getBlockedBuiltIn() {
  return new Promise(resolve => {
    chrome.storage.local.get({ blockedBuiltIn: [] }, data => resolve(data.blockedBuiltIn || []));
  });
}

function setBlockedBuiltIn(list, callback) {
  chrome.storage.local.set({ blockedBuiltIn: list }, callback);
}

async function refreshWordState() {
  latestPersistentWords = await getPersistentWords();
  latestSessionWords = await getSessionWords();
  latestPersistentRecords = await getPersistentRecords();
  latestSessionRecords = await getSessionRecords();
  const blockedBuiltIn = await getBlockedBuiltIn();
  renderWordList(latestPersistentRecords, latestSessionRecords, blockedBuiltIn);
  updateMergedDictionary(latestPersistentWords, latestSessionWords, blockedBuiltIn);
}

chrome.storage.local.get({ enabled: true }, async data => {
  setToggleUI(data.enabled);
  await refreshWordState();
});

dictSearch.addEventListener('input', async () => {
  const blockedBuiltIn = await getBlockedBuiltIn();
  renderWordList(latestPersistentRecords, latestSessionRecords, blockedBuiltIn);
});

toggleEl.addEventListener('change', () => {
  const enabled = toggleEl.checked;
  setToggleUI(enabled);
  chrome.storage.local.set({ enabled });
});

// Delete: built-in entries are blocked, custom entries are removed from records
wordList.addEventListener('click', e => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  const key = btn.dataset.key;
  const scope = btn.dataset.scope;

  if (scope === 'builtin') {
    getBlockedBuiltIn().then(blocked => {
      if (!blocked.includes(key)) {
        setBlockedBuiltIn([...blocked, key], refreshWordState);
      }
    });
    return;
  }

  if (scope === 'session') {
    getSessionRecords().then(sessionRecords => {
      const updated = Object.assign({}, sessionRecords);
      delete updated[key];
      setSessionRecords(updated, refreshWordState);
    });
    return;
  }

  getPersistentRecords().then(records => {
    const updated = Object.assign({}, records);
    delete updated[key];
    chrome.storage.local.set({ [PERSISTENT_RECORDS_KEY]: updated }, refreshWordState);
  });
});

btnAdd.addEventListener('click', () => {
  const orig = inputOriginal.value.trim();
  const repl = inputReplacement.value.trim();
  errorMsg.textContent = '';

  if (!orig || !repl) {
    errorMsg.textContent = '原词和替换词不能为空';
    return;
  }

  if (latestPersistentRecords[orig] || latestSessionRecords[orig]) {
    errorMsg.textContent = `"${orig}" 已存在，请先删除再添加`;
    return;
  }

  if (syncToExternal.checked) {
    const updatedWords = Object.assign({}, latestPersistentWords, { [orig]: repl });
    const updatedRecords = Object.assign({}, latestPersistentRecords, { [orig]: repl });
    chrome.storage.local.set({ customWords: updatedWords, [PERSISTENT_RECORDS_KEY]: updatedRecords }, () => {
      inputOriginal.value = '';
      inputReplacement.value = '';
      refreshWordState();
    });
    return;
  }

  const updatedSessionWords = Object.assign({}, latestSessionWords, { [orig]: repl });
  const updatedSessionRecords = Object.assign({}, latestSessionRecords, { [orig]: repl });
  setSessionWords(updatedSessionWords, () => {
    setSessionRecords(updatedSessionRecords, () => {
      inputOriginal.value = '';
      inputReplacement.value = '';
      refreshWordState();
    });
  });
});

[inputOriginal, inputReplacement].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') btnAdd.click();
  });
});

btnExport.addEventListener('click', () => {
  exportExternalDictionary(latestPersistentWords);
});

btnImport.addEventListener('click', () => {
  fileImport.click();
});

fileImport.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const words = parsed && typeof parsed === 'object' && parsed.words && typeof parsed.words === 'object'
      ? parsed.words
      : parsed;

    if (!words || typeof words !== 'object' || Array.isArray(words)) {
      throw new Error('invalid words');
    }

    const normalized = {};
    Object.entries(words).forEach(([k, v]) => {
      const key = String(k).trim();
      const value = String(v).trim();
      if (key && value) normalized[key] = value;
    });

    const updatedWords = Object.assign({}, latestPersistentWords, normalized);
    const updatedRecords = Object.assign({}, latestPersistentRecords, normalized);
    chrome.storage.local.set({ customWords: updatedWords, [PERSISTENT_RECORDS_KEY]: updatedRecords }, refreshWordState);
    errorMsg.textContent = `已导入 ${Object.keys(normalized).length} 条词汇`;
  } catch (_err) {
    errorMsg.textContent = '导入失败：请使用合法 JSON';
  } finally {
    fileImport.value = '';
  }
});

function parseBatchInput(rawText) {
  const text = rawText.trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed)
          .map(([k, v]) => [String(k).trim(), String(v).trim()])
          .filter(([k, v]) => k && v)
      );
    }
  } catch (_err) {
    // Fallback to line-based parser.
  }

  const result = {};
  text.split(/\r?\n/).forEach(line => {
    const cleaned = line.trim();
    if (!cleaned) return;
    const parts = cleaned.split(/\s*(=>|->|=|:|,)\s*/).filter(part => part && !['=>', '->', '=', ':', ','].includes(part));
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join(' ').trim();
      if (key && value) result[key] = value;
    }
  });
  return result;
}

btnBatchAdd.addEventListener('click', () => {
  errorMsg.textContent = '';
  const entries = parseBatchInput(batchInput.value);
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    errorMsg.textContent = '批量内容为空或格式不正确';
    return;
  }

  if (syncToExternal.checked) {
    const updatedWords = Object.assign({}, latestPersistentWords, entries);
    const updatedRecords = Object.assign({}, latestPersistentRecords, entries);
    chrome.storage.local.set({ customWords: updatedWords, [PERSISTENT_RECORDS_KEY]: updatedRecords }, () => {
      batchInput.value = '';
      errorMsg.textContent = `已批量添加 ${keys.length} 条（已同步）`;
      refreshWordState();
    });
    return;
  }

  const updatedSessionWords = Object.assign({}, latestSessionWords, entries);
  const updatedSessionRecords = Object.assign({}, latestSessionRecords, entries);
  setSessionWords(updatedSessionWords, () => {
    setSessionRecords(updatedSessionRecords, () => {
      batchInput.value = '';
      errorMsg.textContent = `已批量添加 ${keys.length} 条（仅会话）`;
      refreshWordState();
    });
  });
});

btnBatchDelete.addEventListener('click', async () => {
  errorMsg.textContent = '';
  const rawText = batchInput.value.trim();
  if (!rawText) {
    errorMsg.textContent = '请输入要删除的原词（每行一个）';
    return;
  }

  const keysToDelete = new Set();
  rawText.split(/\r?\n/).forEach(line => {
    const cleaned = line.trim();
    if (!cleaned) return;
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(k => { if (k.trim()) keysToDelete.add(k.trim()); });
        return;
      }
    } catch (_) {}
    const parts = cleaned.split(/\s*(=>|->|=|:|,)\s*/);
    const key = parts[0].trim();
    if (key) keysToDelete.add(key);
  });

  if (keysToDelete.size === 0) {
    errorMsg.textContent = '未识别到有效原词';
    return;
  }

  const [persistentRecords, persistentWords, sessionRecords, sessionWords, blocked] = await Promise.all([
    getPersistentRecords(),
    getPersistentWords(),
    getSessionRecords(),
    getSessionWords(),
    getBlockedBuiltIn()
  ]);

  const updatedPersistentRecords = Object.assign({}, persistentRecords);
  const updatedPersistentWords = Object.assign({}, persistentWords);
  const updatedSessionRecords = Object.assign({}, sessionRecords);
  const updatedSessionWords = Object.assign({}, sessionWords);
  keysToDelete.forEach(k => {
    delete updatedPersistentRecords[k];
    delete updatedPersistentWords[k];
    delete updatedSessionRecords[k];
    delete updatedSessionWords[k];
  });

  const newBlocked = [...new Set([...blocked, ...[...keysToDelete].filter(k => BUILT_IN_DICT[k])])];

  chrome.storage.local.set({
    customWords: updatedPersistentWords,
    [PERSISTENT_RECORDS_KEY]: updatedPersistentRecords,
    blockedBuiltIn: newBlocked
  }, () => {
    setSessionWords(updatedSessionWords, () => {
      setSessionRecords(updatedSessionRecords, () => {
        batchInput.value = '';
        errorMsg.textContent = `已删除 ${keysToDelete.size} 条`;
        refreshWordState();
      });
    });
  });
});
