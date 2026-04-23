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

function renderWordList(persistentRecords, sessionRecords) {
  const scopedEntries = [];
  Object.entries(persistentRecords).forEach(([orig, repl]) => {
    scopedEntries.push({ orig, repl, scope: 'persistent' });
  });
  Object.entries(sessionRecords).forEach(([orig, repl]) => {
    scopedEntries.push({ orig, repl, scope: 'session' });
  });

  const entries = scopedEntries.sort((a, b) => a.orig.localeCompare(b.orig, 'zh-Hans-CN'));
  if (entries.length === 0) {
    wordList.innerHTML = '<div class="empty-hint">暂无自定义词汇</div>';
    return;
  }
  wordList.innerHTML = entries.map(({ orig, repl, scope }) => `
    <div class="word-item" data-key="${esc(orig)}" data-scope="${scope}">
      <span class="word-pair">
        ${esc(orig)}<span class="arrow">→</span><span class="replacement">${esc(repl)}</span><span class="scope-badge">${scope === 'persistent' ? '已同步' : '仅会话'}</span>
      </span>
      <button class="btn-delete" data-key="${esc(orig)}" data-scope="${scope}" title="删除">×</button>
    </div>
  `).join('');
}

function setToggleUI(enabled) {
  toggleEl.checked = enabled;
  toggleLabel.textContent = enabled ? '开启中' : '已关闭';
}

function updateMergedDictionary(persistentWords, sessionWords) {
  const mergedDictionary = Object.assign({}, BUILT_IN_DICT, persistentWords, sessionWords);
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

async function refreshWordState() {
  latestPersistentWords = await getPersistentWords();
  latestSessionWords = await getSessionWords();
  latestPersistentRecords = await getPersistentRecords();
  latestSessionRecords = await getSessionRecords();
  renderWordList(latestPersistentRecords, latestSessionRecords);
  updateMergedDictionary(latestPersistentWords, latestSessionWords);
}

chrome.storage.local.get({ enabled: true }, async data => {
  setToggleUI(data.enabled);
  await refreshWordState();
});

toggleEl.addEventListener('change', () => {
  const enabled = toggleEl.checked;
  setToggleUI(enabled);
  chrome.storage.local.set({ enabled });
});

// Delete only removes from records, not from the actual replacement dictionary
wordList.addEventListener('click', e => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  const key = btn.dataset.key;
  const scope = btn.dataset.scope;
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
