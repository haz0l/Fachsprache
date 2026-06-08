'use strict';

const API = 'http://localhost:8080';

// ── Source config ─────────────────────────────────────────────────────────────
const SRC_CFG = {
  'FAZ Wirtschaft':     { ph: 'ph-faz',        badge: 'badge-faz'        },
  'Tagesschau':         { ph: 'ph-tagesschau',  badge: 'badge-tagesschau' },
  'Spiegel Wirtschaft': { ph: 'ph-spiegel',     badge: 'badge-spiegel'    },
};

const SRC_TYPE_CFG = {
  reddit:  { ph: 'ph-reddit',  badge: 'badge-reddit'  },
  newsapi: { ph: 'ph-newsapi', badge: 'badge-newsapi' },
};

const srcCfg = (name, sourceType) => {
  if (sourceType && SRC_TYPE_CFG[sourceType]) return SRC_TYPE_CFG[sourceType];
  return SRC_CFG[name] ?? { ph: 'ph-default', badge: 'badge-default' };
};

// ── Tags ──────────────────────────────────────────────────────────────────────
const PREDEFINED_TAGS = [
  'accounting', 'banking', 'M&A', 'markets',
  'meetings', 'legal', 'macro', 'CFO advisory',
];
let selectedTags    = new Set();
let activeTagFilter = null;

// ── State ─────────────────────────────────────────────────────────────────────
let newsData     = [];
let lastLookup   = null;
let activeIdx    = null;
let heardData    = [];
let glossaryData = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const lookupInput   = document.getElementById('lookup-input');
const lookupBtn     = document.getElementById('lookup-btn');
const lookupStatus  = document.getElementById('lookup-status');
const lookupResult  = document.getElementById('lookup-result');
const tagSelector   = document.getElementById('tag-selector');
const saveRow       = document.getElementById('save-row');
const saveBtn       = document.getElementById('save-btn');
const searchInput   = document.getElementById('search-input');
const glossaryList  = document.getElementById('glossary-list');
const newsGrid      = document.getElementById('news-grid');
const refreshBtn    = document.getElementById('refresh-btn');
const newsCount     = document.getElementById('news-count');
const statusMsg     = document.getElementById('status-msg');
const statusTerms   = document.getElementById('status-terms');
const articleDrawer = document.getElementById('article-drawer');
const drawerInner   = document.getElementById('drawer-inner');
const heardBtn      = document.getElementById('heard-btn');
const heardList     = document.getElementById('heard-list');
const heardCount    = document.getElementById('heard-count');
const totdBanner           = document.getElementById('totd-banner');
const lookupResultsSection = document.getElementById('lookup-results-section');

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setMsg(msg, clearAfter = 0) {
  statusMsg.textContent = msg;
  if (clearAfter) setTimeout(() => { statusMsg.textContent = ''; }, clearAfter);
}

/**
 * Extract likely German nouns (capitalised, length ≥ 5) from headline + summary.
 */
function extractTerms(headline, summary) {
  const text  = `${headline} ${summary}`;
  const seen  = new Set();
  const terms = [];
  for (const raw of text.split(/[\s,.;:!?()\[\]"'»«–—/\\|]+/)) {
    const word = raw.replace(/[^a-zA-ZÀ-ž\-]/g, '');
    if (word.length >= 5 && /^[A-ZÀ-Þ]/.test(word) && !seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase());
      terms.push(word);
      if (terms.length >= 10) break;
    }
  }
  return terms;
}

/**
 * Convert "28 May 2026" → relative time string like "3h ago".
 */
function relativeTime(dateStr) {
  if (!dateStr) return '';
  try {
    const parts = dateStr.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
    if (!parts) return dateStr;
    const d = new Date(`${parts[2]} ${parts[1]}, ${parts[3]}`);
    if (isNaN(d)) return dateStr;
    const diffMs   = Date.now() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs  = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);
    if (diffMins < 1)  return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24)  return `${diffHrs}h ago`;
    if (diffDays < 7)  return `${diffDays}d ago`;
    return dateStr;
  } catch { return dateStr; }
}

/**
 * Change 3: Wrap non-stopword words in clickable spans.
 * Strips leading/trailing punctuation, skips common EN/DE stopwords.
 */
const STOPWORDS = new Set([
  // English
  'the','a','an','is','are','was','were','in','on','at','to','of','and','or',
  'be','been','being','have','has','had','do','does','did','will','would',
  'could','should','may','might','shall','can','not','no','it','its','this',
  'that','with','for','from','by','as','but','if','into','through','about',
  // German common words
  'der','die','das','den','dem','des','ein','eine','einer','eines','einem',
  'und','oder','aber','auch','als','noch','schon','nur','wie','bei','nach',
  'von','zu','mit','für','auf','an','am','im','so','sich','da','dass','dann',
  'mehr','er','sie','es','wir','ihr','ist','sind','hat','wird','war','wurde',
  'werden','haben','sein','nicht','auch','noch','schon','sehr','viel','alle',
]);

function makeClickableText(text) {
  if (!text) return '';
  return text.split(/(\s+)/).map(token => {
    if (!token) return '';
    if (/^\s+$/.test(token)) return token;
    // Split off leading/trailing punctuation
    const m = token.match(/^([^a-zA-ZÀ-ɏ]*)([a-zA-ZÀ-ɏ][\wÀ-ɏ-]*)([^a-zA-ZÀ-ɏ]*)$/);
    if (!m) return esc(token);
    const [, pre, word, post] = m;
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower) || word.length < 3) {
      return esc(pre) + esc(word) + esc(post);
    }
    return `${esc(pre)}<span class="word-clickable" data-word="${esc(word)}">${esc(word)}</span>${esc(post)}`;
  }).join('');
}


// ── Tab navigation (Change 5) ─────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tabName}`);
  });
  // Re-render graph when dict tab becomes visible (needs container dimensions)
  if (tabName === 'dict') {
    renderGraph(glossaryData);
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});


// ── News ──────────────────────────────────────────────────────────────────────
function showSkeletons(n = 9) {
  newsGrid.innerHTML = Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line" style="width:38%;margin-bottom:10px"></div>
        <div class="skeleton skeleton-line" style="width:95%"></div>
        <div class="skeleton skeleton-line" style="width:85%"></div>
        <div class="skeleton skeleton-line" style="width:70%;margin-bottom:0"></div>
      </div>
    </div>`).join('');
}

async function loadNews() {
  showSkeletons();
  setMsg('Loading feeds…');
  try {
    const res = await fetch(`${API}/api/news`);
    newsData  = await res.json();
    renderNews();
    setMsg('Ready', 2500);
  } catch {
    newsGrid.innerHTML = '<p class="empty-state">Could not reach the server.<br>Make sure <code>python main.py --web</code> is running.</p>';
    setMsg('Connection error');
  }
}

/**
 * Change 1: Render news cards (rss + newsapi) in grid;
 *            render reddit posts in the separate list section below.
 */
function renderNews() {
  // Partition by source_type, preserving original indices for openDrawer
  const articles = newsData.map((item, i) => ({ item, i }))
                            .filter(({ item }) => item.source_type !== 'reddit');
  const redditItems = newsData.map((item, i) => ({ item, i }))
                               .filter(({ item }) => item.source_type === 'reddit');

  // ── News grid ──────────────────────────────────────────────────────────────
  if (!articles.length) {
    newsGrid.innerHTML = '<p class="empty-state">No articles found.</p>';
  } else {
    newsGrid.innerHTML = articles.map(({ item, i }) => {
      const { ph, badge } = srcCfg(item.source, item.source_type);
      const imgInner = item.image
        ? `<img src="${esc(item.image)}" alt="" loading="lazy">`
        : `<span class="card-img-label">${esc(item.source)}</span>`;

      return `
        <article class="news-card" data-idx="${i}" tabindex="0" role="button" aria-label="${esc(item.title)}">
          <div class="card-img ${ph}" data-source="${esc(item.source)}">${imgInner}</div>
          <div class="card-body">
            <div class="card-meta">
              <span class="source-badge ${badge}">${esc(item.source)}</span>
              ${item.date ? `<span class="card-date">${esc(item.date)}</span>` : ''}
            </div>
            <h3 class="card-headline">${esc(item.title)}</h3>
            ${item.summary ? `<p class="card-summary">${esc(item.summary)}</p>` : ''}
          </div>
        </article>`;
    }).join('');

    newsGrid.querySelectorAll('.card-img img').forEach(img => {
      img.addEventListener('error', function () {
        const wrap   = this.parentElement;
        const source = wrap.dataset.source;
        this.remove();
        if (!wrap.querySelector('.card-img-label')) {
          const lbl     = document.createElement('span');
          lbl.className = 'card-img-label';
          lbl.textContent = source;
          wrap.appendChild(lbl);
        }
      });
    });

    newsGrid.querySelectorAll('.news-card').forEach(card => {
      const open = () => openDrawer(+card.dataset.idx);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    });
  }

  // ── Reddit section ─────────────────────────────────────────────────────────
  renderReddit(redditItems);

  newsCount.textContent = `${newsData.length} article${newsData.length !== 1 ? 's' : ''}`;
}

// ── Change 3: Subreddit colour map (dark-theme) ──────────────────────────────
const SUBREDDIT_COLORS = {
  'r/Finanzen':            { bg: 'rgba(76,155,232,0.12)',  text: '#4C9BE8', icon: '#4C9BE8' },
  'r/Mauerstrassenwetten': { bg: 'rgba(255,140,66,0.12)',  text: '#FF8C42', icon: '#FF8C42' },
  'r/germany':             { bg: 'rgba(255,68,68,0.12)',   text: '#FF5555', icon: '#FF5555' },
  'r/AskGermany':          { bg: 'rgba(255,209,102,0.12)', text: '#FFD166', icon: '#FFD166' },
  'r/eupersonalfinance':   { bg: 'rgba(0,229,255,0.12)',   text: '#00E5FF', icon: '#00E5FF' },
  'r/ExpatGermany':        { bg: 'rgba(180,110,255,0.12)', text: '#B46EFF', icon: '#B46EFF' },
  'r/economics':           { bg: 'rgba(160,160,160,0.08)', text: '#808080', icon: '#808080' },
};
function subredditColors(source) {
  return SUBREDDIT_COLORS[source] || { bg: 'rgba(0,229,255,0.12)', text: '#00E5FF', icon: '#00E5FF' };
}

/** Deterministic fake upvote score derived from title string. */
function hashScore(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h % 900) + 50; // range 50–950
}

/** Change 3: Render Reddit posts as styled cards in the left column. */
function renderReddit(redditItems) {
  const redditList    = document.getElementById('reddit-list');
  const redditCountEl = document.getElementById('reddit-count');
  if (!redditList) return;

  if (!redditItems.length) {
    redditList.innerHTML = '<div class="reddit-empty">No posts loaded</div>';
    if (redditCountEl) redditCountEl.textContent = '';
    return;
  }
  if (redditCountEl) redditCountEl.textContent = String(redditItems.length);

  redditList.innerHTML = redditItems.map(({ item, i }) => {
    const colors = subredditColors(item.source);
    const letter = (item.source.replace('r/', '')[0] || 'R').toUpperCase();
    const score  = hashScore(item.title);
    const time   = relativeTime(item.date);
    const viewLink = item.link
      ? `<a class="reddit-post-discuss" href="${esc(item.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View &#8599;</a>`
      : '';
    return `
      <div class="reddit-post" data-idx="${i}" role="button" tabindex="0">
        <div class="reddit-post-top">
          <span class="reddit-sub-icon" style="background:${colors.icon}">${letter}</span>
          <span class="reddit-sub-pill" style="background:${colors.bg};color:${colors.text}">${esc(item.source)}</span>
          <span class="reddit-post-time">${esc(time)}</span>
        </div>
        <div class="reddit-post-title">${esc(item.title)}</div>
        <div class="reddit-post-meta">
          <span class="reddit-post-score">&#9650; ${score}</span>
          <span class="reddit-post-user">u/redditor</span>
          ${viewLink}
        </div>
      </div>`;
  }).join('');

  redditList.querySelectorAll('.reddit-post').forEach(post => {
    post.addEventListener('click', () => openDrawer(+post.dataset.idx));
    post.addEventListener('keydown', e => { if (e.key === 'Enter') openDrawer(+post.dataset.idx); });
  });
}


// ── Article drawer ────────────────────────────────────────────────────────────
/**
 * Changes 3 + 4: Summary words are clickable; context section auto-loads
 *                at the top of the drawer content (no manual button).
 */
function openDrawer(idx) {
  const item = newsData[idx];
  if (!item) return;

  activeIdx = idx;

  // Highlight active item (card or reddit row)
  document.querySelectorAll('.news-card, .reddit-post')
          .forEach(c => c.classList.remove('active'));
  document.querySelectorAll(`[data-idx="${idx}"]`)
          .forEach(c => c.classList.add('active'));

  const { ph, badge } = srcCfg(item.source, item.source_type);
  const terms         = extractTerms(item.title, item.summary);

  const heroHtml = item.image
    ? `<img class="drawer-hero-img" src="${esc(item.image)}" alt=""
          onerror="this.replaceWith(Object.assign(document.createElement('div'),
            {className:'drawer-img-placeholder ${ph}',innerHTML:'<span>${esc(item.source)}</span>'}));">`
    : `<div class="drawer-img-placeholder ${ph}"><span>${esc(item.source)}</span></div>`;

  const chipsHtml = terms.length
    ? `<div class="drawer-chips">
         <div class="chips-label">Click a term to look it up</div>
         <div class="chips-list">
           ${terms.map(w => `<button class="chip" data-term="${esc(w)}">${esc(w)}</button>`).join('')}
         </div>
       </div>`
    : '';

  const linkHtml = item.link
    ? `<a href="${esc(item.link)}" target="_blank" rel="noopener" class="read-more-btn">
         Read full article &#8594;
       </a>`
    : '';

  drawerInner.innerHTML = `
    <div class="drawer-header">
      <button class="drawer-close" id="drawer-close" aria-label="Close">&#x2715;</button>
    </div>
    ${heroHtml}
    <div class="drawer-content">
      <div class="drawer-meta">
        <span class="source-badge ${badge}">${esc(item.source)}</span>
        ${item.date ? `<span class="drawer-date">${esc(item.date)}</span>` : ''}
      </div>
      <h2 class="drawer-headline">${esc(item.title)}</h2>

      <!-- Change 4: Context & Analysis auto-loads here -->
      <div class="context-section">
        <div class="context-section-title">Context &amp; Analysis</div>
        <div id="explain-container"></div>
      </div>

      <!-- Change 3: Summary with clickable words -->
      <p class="drawer-body"></p>
      ${chipsHtml}
      ${linkHtml}
    </div>`;

  // Inject clickable summary text (Change 3)
  drawerInner.querySelector('.drawer-body').innerHTML =
    makeClickableText(item.summary);

  articleDrawer.classList.add('open');
  articleDrawer.scrollTop = 0;

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  // Wire extracted-term chips
  drawerInner.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      lookupInput.value = btn.dataset.term;
      doLookup(btn.dataset.term);
    });
  });

  // Wire clickable summary words (Change 3)
  drawerInner.querySelectorAll('.word-clickable').forEach(span => {
    span.addEventListener('click', () => {
      lookupInput.value = span.dataset.word;
      doLookup(span.dataset.word);
    });
  });

  // Auto-load context explainer (Change 4)
  explainArticle(item.title, item.summary);
}

function closeDrawer() {
  articleDrawer.classList.remove('open');
  document.querySelectorAll('.news-card, .reddit-post')
          .forEach(c => c.classList.remove('active'));
  activeIdx = null;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });


// ── Context Explainer (Change 4 — auto-loaded) ───────────────────────────────
async function explainArticle(headline, summary) {
  const container = document.getElementById('explain-container');
  if (!container) return;

  // Shimmer skeleton while loading
  container.innerHTML = `
    <div class="explain-loading">
      <div class="skeleton explain-skel" style="width:100%;height:12px"></div>
      <div class="skeleton explain-skel" style="width:85%"></div>
      <div class="skeleton explain-skel" style="width:100%;height:12px;margin-top:6px"></div>
      <div class="skeleton explain-skel" style="width:72%"></div>
      <div class="skeleton explain-skel" style="width:90%"></div>
      <div class="skeleton explain-skel" style="width:60%"></div>
    </div>`;

  try {
    const res  = await fetch(`${API}/api/explain-article`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ headline, summary }),
    });
    const data = await res.json();
    renderExplain(container, data);
  } catch {
    container.innerHTML =
      '<p style="font-size:12px;color:var(--red);margin-top:4px">Could not load explanation.</p>';
  }
}

function renderExplain(container, data) {
  const keyTermsHtml = (data.key_terms || []).length
    ? `<div class="explain-item">
         <div class="explain-label">Key terms</div>
         <div class="chips-list">
           ${(data.key_terms || []).map(t =>
             `<button class="chip" data-term="${esc(t.term)}" title="${esc(t.brief_english_meaning)}">${esc(t.term)}</button>`
           ).join('')}
         </div>
       </div>`
    : '';

  container.innerHTML = `
    <div class="explain-result">
      <div class="explain-item">
        <div class="explain-label">What&rsquo;s happening</div>
        <div class="explain-text">${esc(data.what)}</div>
      </div>
      <div class="explain-item explain-why">
        <div class="explain-label">Why it matters</div>
        <div class="explain-text">${esc(data.why_it_matters)}</div>
      </div>
      <div class="explain-item">
        <div class="explain-label">Background</div>
        <div class="explain-text">${esc(data.background)}</div>
      </div>
      ${keyTermsHtml}
    </div>`;

  container.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      lookupInput.value = btn.dataset.term;
      doLookup(btn.dataset.term);
    });
  });
}


// ── Lookup ────────────────────────────────────────────────────────────────────
async function doLookup(term) {
  if (!term.trim()) return;

  lookupStatus.textContent = 'Looking up…';
  lookupStatus.className   = 'lookup-status';
  lookupResult.classList.add('hidden');
  tagSelector.classList.add('hidden');
  saveRow.classList.add('hidden');
  lastLookup = null;
  selectedTags.clear();
  setMsg(`Looking up: ${term}`);
  if (lookupResultsSection) lookupResultsSection.classList.add('open');

  try {
    const res  = await fetch(`${API}/api/lookup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ term }),
    });
    const data = await res.json();
    lastLookup = data;

    renderLookupResult(data);
    lookupStatus.textContent = data.error ? 'Error — see below' : 'Found';
    lookupStatus.className   = `lookup-status ${data.error ? 'err' : 'ok'}`;
    if (!data.error) {
      renderTagSelector();
      saveRow.classList.remove('hidden');
      setMsg(`Looked up: ${data.term}`, 3000);
    }
  } catch {
    lookupStatus.textContent = 'Connection error';
    lookupStatus.className   = 'lookup-status err';
    setMsg('Connection error', 3000);
  }
}

function renderLookupResult(d) {
  const deconHtml = (d.deconstruction && d.deconstruction !== 'N/A')
    ? `<div class="result-row">
         <div class="result-label-sm">Compound word</div>
         <span class="result-decon">${esc(d.deconstruction)}</span>
       </div>`
    : '';

  lookupResult.innerHTML = `
    <div class="result-term">${esc(d.term)}</div>
    <div class="result-row">
      <div class="result-label-sm">Translation</div>
      <div class="result-value-sm result-translation">${esc(d.translation)}</div>
    </div>
    <div class="result-row">
      <div class="result-label-sm">Explanation</div>
      <div class="result-value-sm">${esc(d.explanation)}</div>
    </div>
    <div class="result-row">
      <div class="result-label-sm">Example</div>
      <div class="result-value-sm" style="font-style:italic">${esc(d.example)}</div>
    </div>
    ${deconHtml}`;

  lookupResult.classList.remove('hidden');
}

lookupBtn.addEventListener('click', () => doLookup(lookupInput.value.trim()));
lookupInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doLookup(lookupInput.value.trim());
});

// ── Tag selector ──────────────────────────────────────────────────────────────
function renderTagSelector() {
  selectedTags.clear();
  tagSelector.innerHTML = `
    <div class="tag-selector-label">Add tags (optional)</div>
    <div class="tag-chips-list">
      ${PREDEFINED_TAGS.map(t =>
        `<button class="tag-chip" data-tag="${esc(t)}">${esc(t)}</button>`
      ).join('')}
    </div>`;
  tagSelector.classList.remove('hidden');

  tagSelector.querySelectorAll('.tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        btn.classList.remove('selected');
      } else {
        selectedTags.add(tag);
        btn.classList.add('selected');
      }
    });
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  if (!lastLookup || lastLookup.error) return;
  const d = lastLookup;
  try {
    await fetch(`${API}/api/glossary`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        term:           d.term,
        translation:    d.translation,
        explanation:    d.explanation,
        example:        d.example,
        deconstruction: d.deconstruction || 'N/A',
        tags:           [...selectedTags],
      }),
    });
    setMsg(`Saved: ${d.term}`, 3000);
    saveBtn.textContent = 'Saved ✓';
    setTimeout(() => { saveBtn.textContent = 'Save to glossary'; }, 2000);
    await loadGlossary();            // await so glossaryData is fresh
    loadTermOfDay();
    loadHeatmap();
    showRelationSuggestions(d.term); // Change 7: suggest links after save
  } catch {
    setMsg('Save error', 3000);
  }
});


// ── Change 7: Relation suggestions ───────────────────────────────────────────
async function showRelationSuggestions(savedTerm) {
  const relDiv = document.getElementById('relation-suggestions');
  if (!relDiv) return;
  relDiv.classList.add('hidden');
  relDiv.innerHTML = '';

  if (glossaryData.length < 2) return; // need at least one other term

  try {
    const res         = await fetch(`${API}/api/glossary/suggest-relations`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ term: savedTerm }),
    });
    const suggestions = await res.json();
    if (!Array.isArray(suggestions) || !suggestions.length) return;
    renderRelationSuggestions(savedTerm, suggestions, relDiv);
  } catch {
    // Silent — non-critical
  }
}

function renderRelationSuggestions(savedTerm, suggestions, relDiv) {
  relDiv.innerHTML = `
    <div class="relation-title">Connect "<strong>${esc(savedTerm)}</strong>" to related terms?</div>
    ${suggestions.map(s => `
      <div class="relation-item">
        <div class="relation-item-left">
          <div class="relation-item-term">${esc(s.term)}</div>
          <div class="relation-item-reason">${esc(s.reason)}</div>
        </div>
        <div class="relation-btns">
          <button class="btn-connect" data-link="${esc(s.term)}">Connect</button>
          <button class="btn-rel-dismiss" title="Dismiss">&#x2715;</button>
        </div>
      </div>`).join('')}`;
  relDiv.classList.remove('hidden');

  relDiv.querySelectorAll('.btn-connect').forEach(btn => {
    btn.addEventListener('click', async () => {
      const termB = btn.dataset.link;
      try {
        await fetch(`${API}/api/glossary/link`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ term_a: savedTerm, term_b: termB }),
        });
        setMsg(`Linked: ${savedTerm} ↔ ${termB}`, 3000);
        btn.closest('.relation-item').remove();
        if (!relDiv.querySelectorAll('.relation-item').length) {
          relDiv.classList.add('hidden');
        }
        loadGlossary(); // refresh graph
      } catch {
        setMsg('Link error', 2500);
      }
    });
  });

  relDiv.querySelectorAll('.btn-rel-dismiss').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.relation-item').remove();
      if (!relDiv.querySelectorAll('.relation-item').length) {
        relDiv.classList.add('hidden');
      }
    });
  });
}


// ── Glossary ──────────────────────────────────────────────────────────────────
async function loadGlossary(query) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (activeTagFilter) params.set('tag', activeTagFilter);
  const qs  = params.toString();
  const url = qs ? `${API}/api/glossary?${qs}` : `${API}/api/glossary`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    glossaryData = data;
    renderGlossary(data);
    // Re-render graph only if dict tab is visible
    if (!document.getElementById('tab-dict').classList.contains('hidden')) {
      renderGraph(data);
    }
    statusTerms.textContent = `${data.length} term${data.length !== 1 ? 's' : ''} saved`;
  } catch {
    glossaryList.innerHTML = '<div class="glossary-empty">Connection error</div>';
  }
}

function renderGlossary(entries) {
  if (!entries.length) {
    glossaryList.innerHTML = `<div class="glossary-empty">
      No terms saved yet.<br>Look up a term and click&nbsp;"Save to glossary".
    </div>`;
    return;
  }

  glossaryList.innerHTML = entries.map((e, i) => {
    const tagsHtml = (e.tags && e.tags.length)
      ? `<div class="g-tags">${e.tags.map(t => `<span class="tag-badge">${esc(t)}</span>`).join('')}</div>`
      : '';
    const relHtml = (e.related_terms && e.related_terms.length)
      ? `<div class="g-related">${e.related_terms.map(r => `<span class="g-related-badge">${esc(r)}</span>`).join('')}</div>`
      : '';

    return `
    <div class="g-entry" data-idx="${i}">
      <div class="g-entry-top">
        <div>
          <div class="g-term">${esc(e.term)}</div>
          <div class="g-translation">${esc(e.translation)}</div>
          ${(e.deconstruction && e.deconstruction !== 'N/A')
            ? `<div class="g-decon">${esc(e.deconstruction)}</div>` : ''}
          ${tagsHtml}
          ${relHtml}
        </div>
        <button class="g-del" data-term="${esc(e.term)}" title="Delete">&#x2715;</button>
      </div>
      <div class="g-detail" id="gd-${i}">
        <div class="g-detail-label">Explanation</div>
        <p>${esc(e.explanation)}</p>
        <div class="g-detail-label">Example</div>
        <p style="font-style:italic">${esc(e.example)}</p>
      </div>
    </div>`;
  }).join('');

  glossaryList.querySelectorAll('.g-entry').forEach((el, i) => {
    el.addEventListener('click', ev => {
      if (ev.target.closest('.g-del')) return;
      document.getElementById(`gd-${i}`).classList.toggle('open');
    });
  });

  glossaryList.querySelectorAll('.g-del').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      const term = btn.dataset.term;
      await fetch(`${API}/api/glossary/${encodeURIComponent(term)}`, { method: 'DELETE' });
      setMsg(`Deleted: ${term}`, 2000);
      loadGlossary(searchInput.value.trim() || undefined);
    });
  });
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () => loadGlossary(searchInput.value.trim() || undefined),
    300,
  );
});

// ── Tag filter bar (now in dict-toolbar) ──────────────────────────────────────
function renderTagFilterBar() {
  const bar = document.getElementById('tag-filter-bar');
  if (!bar) return;
  bar.innerHTML = [
    `<button class="tag-filter-chip${activeTagFilter === null ? ' active' : ''}" data-tag="">All</button>`,
    ...PREDEFINED_TAGS.map(t =>
      `<button class="tag-filter-chip${activeTagFilter === t ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`
    ),
  ].join('');

  bar.querySelectorAll('.tag-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTagFilter = btn.dataset.tag || null;
      renderTagFilterBar();
      loadGlossary(searchInput.value.trim() || undefined);
    });
  });
}


// ── Change 7: D3 Knowledge Graph ─────────────────────────────────────────────
const TAG_COLORS = {
  'accounting':   '#4C9BE8',  // blue
  'banking':      '#FF8C42',  // orange
  'M&A':          '#B46EFF',  // purple
  'markets':      '#00E5FF',  // cyan (was green)
  'meetings':     '#FFD166',  // yellow
  'legal':        '#FF4444',  // red
  'macro':        '#4CCFE8',  // light blue
  'CFO advisory': '#89D4CF',  // teal (was dark green)
};

function nodeColor(n) {
  if (n.tags && n.tags[0] && TAG_COLORS[n.tags[0]]) return TAG_COLORS[n.tags[0]];
  return '#8BA89A';
}
function nodeRadius(n) { return 12 + (n.connections || 0) * 3; }

function renderGraph(entries) {
  const container   = document.getElementById('graph-container');
  const svgEl       = document.getElementById('knowledge-graph');
  const placeholder = document.getElementById('graph-placeholder');
  if (!container || !svgEl) return;

  // Remove any existing popup
  container.querySelectorAll('.graph-popup').forEach(p => p.remove());

  if (!entries || entries.length < 2) {
    if (placeholder) placeholder.style.display = 'flex';
    svgEl.innerHTML = '';
    return;
  }
  if (placeholder) placeholder.style.display = 'none';

  const W = container.clientWidth  || 600;
  const H = container.clientHeight || 320;

  // Build nodes
  const nodes = entries.map(e => ({
    id:          e.term,
    term:        e.term,
    translation: e.translation || '',
    explanation: e.explanation || '',
    tags:        e.tags || [],
    connections: (e.related_terms || []).length,
  }));

  // Build links (deduplicated)
  const termSet  = new Set(entries.map(e => e.term));
  const linkSet  = new Set();
  const links    = [];
  entries.forEach(e => {
    (e.related_terms || []).forEach(rt => {
      if (!termSet.has(rt)) return;
      const key = [e.term, rt].sort().join('\x00');
      if (!linkSet.has(key)) {
        linkSet.add(key);
        links.push({ source: e.term, target: rt });
      }
    });
  });

  const d3Svg = d3.select('#knowledge-graph');
  d3Svg.selectAll('*').remove();

  const g = d3Svg.append('g');

  // Zoom & pan
  d3Svg.call(
    d3.zoom()
      .scaleExtent([0.25, 5])
      .on('zoom', ev => g.attr('transform', ev.transform))
  );

  // Links
  g.append('g')
   .selectAll('line')
   .data(links)
   .join('line')
   .attr('class', 'graph-link');

  // Nodes
  const node = g.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'graph-node')
    .call(
      d3.drag()
        .on('start', (ev, d) => {
          if (!ev.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end',  (ev, d) => {
          if (!ev.active) sim.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
    );

  node.append('circle')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => nodeColor(d))
      .attr('opacity', 0.88);

  node.append('text')
      .text(d => d.term.length > 13 ? d.term.slice(0, 11) + '…' : d.term)
      .attr('y', d => nodeRadius(d) + 12)
      .style('font-size', '10px')
      .style('fill', 'var(--text-2)')
      .style('text-anchor', 'middle');

  // Popup on click
  node.on('click', (ev, d) => {
    ev.stopPropagation();
    container.querySelectorAll('.graph-popup').forEach(p => p.remove());
    const rect = container.getBoundingClientRect();
    const px   = Math.min(ev.clientX - rect.left + 12, W - 230);
    const py   = Math.max(ev.clientY - rect.top  - 10, 6);
    const popup = document.createElement('div');
    popup.className = 'graph-popup';
    popup.style.left = `${px}px`;
    popup.style.top  = `${py}px`;
    popup.innerHTML  = `
      <div class="graph-popup-term">${esc(d.term)}</div>
      <div class="graph-popup-translation">${esc(d.translation)}</div>
      <div class="graph-popup-explanation">${esc(d.explanation.slice(0, 110))}${d.explanation.length > 110 ? '…' : ''}</div>`;
    container.appendChild(popup);
  });

  // Dismiss popup when clicking SVG background
  d3Svg.on('click', () => container.querySelectorAll('.graph-popup').forEach(p => p.remove()));

  // Force simulation
  const sim = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(links).id(d => d.id).distance(90))
    .force('charge',    d3.forceManyBody().strength(-160))
    .force('center',    d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 10));

  const linkSel = g.select('g').selectAll('line');
  sim.on('tick', () => {
    g.selectAll('line.graph-link')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — Term of the Day (now in dict tab)
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTermOfDay() {
  try {
    const res  = await fetch(`${API}/api/term-of-the-day`);
    const data = await res.json();
    renderTermOfDay(data);
  } catch { /* silent */ }
}

function renderTermOfDay(data) {
  if (!data || data.empty) {
    totdBanner.innerHTML = `<div class="totd-empty">Save your first term to get a daily word.</div>`;
    totdBanner.classList.remove('hidden');
    return;
  }
  totdBanner.innerHTML = `
    <div class="totd-label">Term of the Day</div>
    <div class="totd-term">${esc(data.term)}</div>
    <div class="totd-translation">${esc(data.translation)}</div>
    ${data.example ? `<div class="totd-example">${esc(data.example)}</div>` : ''}`;
  totdBanner.classList.remove('hidden');
}


// ═══════════════════════════════════════════════════════════════════════════════
// Change 6 — Heard Today (unified input; heardBtn = "Log" button)
// ═══════════════════════════════════════════════════════════════════════════════

async function loadHeard() {
  try {
    const res = await fetch(`${API}/api/heard`);
    heardData = await res.json();
    renderHeard();
  } catch { /* silent */ }
}

function renderHeard() {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  heardCount.textContent = heardData.length
    ? `${heardData.length} term${heardData.length !== 1 ? 's' : ''} — ${today}`
    : today;

  heardList.innerHTML = heardData.map(entry =>
    `<button class="heard-chip" data-term="${esc(entry.term)}">${esc(entry.term)}</button>`
  ).join('');

  heardList.querySelectorAll('.heard-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      lookupInput.value = chip.dataset.term;
      doLookup(chip.dataset.term);
    });
  });
}

async function addHeard(term) {
  term = term.trim();
  if (!term) return;

  // Optimistic UI
  const already = heardData.some(e => e.term.toLowerCase() === term.toLowerCase());
  if (!already) {
    heardData.push({ term, timestamp: new Date().toISOString() });
    renderHeard();
  }
  // Note: shared input is NOT cleared — user may still want to Translate the same term

  try {
    await fetch(`${API}/api/heard`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ term }),
    });
    loadHeard();
    loadHeatmap();
  } catch {
    if (!already) {
      heardData = heardData.filter(e => e.term !== term);
      renderHeard();
      setMsg('Could not save heard term', 2500);
    }
  }
}

// Change 6: "Log" button uses the shared lookupInput
heardBtn.addEventListener('click', () => {
  const term = lookupInput.value.trim();
  if (!term) return;
  addHeard(term);
  const orig = heardBtn.textContent;
  heardBtn.textContent = 'Logged ✓';
  setTimeout(() => { heardBtn.textContent = orig; }, 1400);
});


// ═══════════════════════════════════════════════════════════════════════════════
// Change 2 — Activity Heatmap (now inside News Feed tab)
// ═══════════════════════════════════════════════════════════════════════════════

async function loadHeatmap() {
  try {
    const res  = await fetch(`${API}/api/activity`);
    const data = await res.json();
    renderHeatmap(data);
  } catch { /* silent */ }
}

function renderHeatmap(data) {
  const grid  = document.getElementById('heatmap-grid');
  const total = document.getElementById('heatmap-total');
  if (!grid) return;

  const today = new Date();
  const days  = [];
  for (let i = 89; i >= 0; i--) {
    const d   = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: data[key] || 0 });
  }

  const level = count => {
    if (count === 0) return 0;
    if (count === 1) return 1;
    if (count <= 4)  return 2;
    if (count <= 9)  return 3;
    return 4;
  };

  const totalCount = days.reduce((s, d) => s + d.count, 0);
  if (total) {
    total.textContent = totalCount ? `${totalCount} in 90 days` : '';
  }

  // Month summary line below heatmap
  const thisMonth    = today.toISOString().slice(0, 7); // YYYY-MM
  const monthCount   = days
    .filter(d => d.date.startsWith(thisMonth))
    .reduce((s, d) => s + d.count, 0);
  const monthSummary = document.getElementById('heatmap-month-summary');
  if (monthSummary) {
    monthSummary.textContent = monthCount
      ? `${monthCount} term${monthCount !== 1 ? 's' : ''} learned this month`
      : 'No activity this month yet';
  }

  const firstDow = new Date(days[0].date).getDay();
  const padded   = [...Array(firstDow).fill(null), ...days];
  const weeks    = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  grid.innerHTML = weeks.map(week =>
    `<div class="heatmap-week">${
      week.map(day =>
        day
          ? `<div class="heatmap-cell heatmap-${level(day.count)}"
                title="${day.date}${day.count ? `: ${day.count} action${day.count !== 1 ? 's' : ''}` : ''}"></div>`
          : `<div class="heatmap-cell heatmap-empty"></div>`
      ).join('')
    }</div>`
  ).join('');
}


// ── Init ──────────────────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', loadNews);

// Close the collapsible lookup results panel
const closeLookupPanelBtn = document.getElementById('close-lookup-panel');
if (closeLookupPanelBtn) {
  closeLookupPanelBtn.addEventListener('click', () => {
    if (lookupResultsSection) lookupResultsSection.classList.remove('open');
    lookupResult.classList.add('hidden');
    tagSelector.classList.add('hidden');
    saveRow.classList.add('hidden');
    lookupStatus.textContent = '';
    lastLookup = null;
    selectedTags.clear();
    const relDiv = document.getElementById('relation-suggestions');
    if (relDiv) relDiv.classList.add('hidden');
  });
}

loadNews();
loadGlossary();
renderTagFilterBar();
loadTermOfDay();
loadHeard();
loadHeatmap();

// Add related_terms badge styles (inline, lightweight)
const styleEl = document.createElement('style');
styleEl.textContent = `
  .g-related { display:flex; flex-wrap:wrap; gap:3px; margin-top:4px; }
  .g-related-badge {
    font-size:10px; padding:1px 7px; border-radius:2px;
    background:rgba(0,229,255,0.10); color:#00E5FF; font-weight:500;
  }
`;
document.head.appendChild(styleEl);
