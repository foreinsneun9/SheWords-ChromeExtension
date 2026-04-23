const BUILT_IN_DICT = window.SHEWORDS_BUILT_IN_DICT || {};

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);

function buildPattern(dict) {
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return null;
  return new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
}

function applyCaseFormat(original, replacement) {
  if (!original || !replacement) return replacement;

  // Check if original is all uppercase
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }

  // Check if original is title case (first letter uppercase)
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }

  // Otherwise keep replacement as-is
  return replacement;
}

function replaceTextNode(node, dict, pattern) {
  const text = node.nodeValue;
  if (!pattern || !pattern.test(text)) return;
  pattern.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let last = 0;
  let match;
  pattern.lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      frag.appendChild(document.createTextNode(text.slice(last, match.index)));
    }

    // Find the dictionary key (case-insensitive match)
    const matchedText = match[0];
    const dictKey = Object.keys(dict).find(k => k.toLowerCase() === matchedText.toLowerCase());
    const replacement = dictKey ? dict[dictKey] : matchedText;
    const formattedReplacement = applyCaseFormat(matchedText, replacement);

    const span = document.createElement('span');
    span.className = 'shewords-highlight';
    span.style.backgroundColor = '#FAC5DB';
    span.dataset.original = matchedText;
    span.textContent = formattedReplacement;
    frag.appendChild(span);
    last = match.index + matchedText.length;
  }

  if (last < text.length) {
    frag.appendChild(document.createTextNode(text.slice(last)));
  }

  node.parentNode.replaceChild(frag, node);
}

function isInsideSkipTag(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.classList && el.classList.contains('shewords-highlight')) return true;
    el = el.parentElement;
  }
  return false;
}

function replaceAll(root, dict, pattern) {
  if (!pattern) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!isInsideSkipTag(node)) nodes.push(node);
  }
  nodes.forEach(n => replaceTextNode(n, dict, pattern));
}

function clearHighlights() {
  document.querySelectorAll('.shewords-highlight').forEach(span => {
    const parent = span.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(span.dataset.original || span.textContent), span);
    parent.normalize();
  });
}

let observer = null;
let currentDict = {};
let currentPattern = null;
let isEnabled = true;

function mergeDict(persistentWords) {
  return Object.assign({}, BUILT_IN_DICT, persistentWords || {});
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(mutations => {
    if (!isEnabled) return;
    observer.disconnect();
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!isInsideSkipTag(node)) replaceTextNode(node, currentDict, currentPattern);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          replaceAll(node, currentDict, currentPattern);
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function applyConfig(enabled, dictionary) {
  isEnabled = enabled;
  currentDict = dictionary || {};
  currentPattern = buildPattern(currentDict);

  if (!isEnabled) {
    stopObserver();
    clearHighlights();
    return;
  }

  replaceAll(document.body, currentDict, currentPattern);
  startObserver();
}

function reloadConfig() {
  chrome.storage.local.get({ enabled: true, customWords: {}, mergedDictionary: null }, localData => {
    const dictionary = localData.mergedDictionary && typeof localData.mergedDictionary === 'object'
      ? localData.mergedDictionary
      : mergeDict(localData.customWords);
    applyConfig(localData.enabled, dictionary);
  });
}

reloadConfig();

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local' && area !== 'session') return;
  stopObserver();
  clearHighlights();
  reloadConfig();
});