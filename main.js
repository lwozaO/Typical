// --- Utility ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const uniqBy = (arr, key) => {
  const seen = new Set();
  return arr.filter(it => {
    const k = key(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// --- Fetchers ---
// Expected output: { word, meaning, pos }
async function fetchJlptApiN1() {
  const out = [];
  try {
    // try paginated fetch to be safe
    let offset = 0;
    const limit = 500;
    while (true) {
      const url = `https://jlpt-vocab-api.vercel.app/api/words?level=1&offset=${offset}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      if (!data || !data.words || data.words.length === 0) break;
      data.words.forEach(w => {
        out.push({
          word: w.word || w.expression || w.kanji || "",
          meaning: (w.meaning || w.meanings || w.translation || "").toString(),
          pos: (w.pos || w.partOfSpeech || "").toString()
        });
      });
      offset += limit;
      if (data.words.length < limit) break;
      await sleep(100);
    }
  } catch (e) {
    console.warn("JLPT API fetch failed", e);
  }
  return out;
}

async function fetchOpenAnkiN1Csv() {
  // raw CSV columns differ; we try to parse "expression,reading,gloss,pos,level" style
  const url = "https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n1.csv";
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const rows = lines.map(line => {
      // naive CSV split (no embedded commas expected)
      const cols = line.split(",");
      return {
        word: cols[0]?.trim() || "",
        meaning: (cols[2] || cols[3] || "").trim(),
        pos: (cols[3] || "").trim()
      };
    });
    // remove header-like lines
    return rows.filter(r => r.word && r.meaning && r.word !== "expression");
  } catch (e) {
    console.warn("OpenAnki CSV fetch failed", e);
    return [];
  }
}

async function fetchElzupJsonN1() {
  const url = "https://raw.githubusercontent.com/elzup/jlpt-word-list/master/out/jlpt-n1.json";
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    // Expect array of objects: { expression, reading, gloss? }
    return json.map(x => ({
      word: x.expression || x.word || "",
      meaning: (x.gloss || x.meaning || "").toString(),
      pos: (x.pos || "").toString()
    })).filter(x => x.word);
  } catch (e) {
    console.warn("elzup JSON fetch failed", e);
    return [];
  }
}

async function fetchBluskyoN1Json() {
  const url = "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/master/N1.json";
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const arr = await res.json();
    // Expect array like [{kanji, kana, english}]
    return arr.map(x => ({
      word: x.kanji || x.kana || "",
      meaning: (x.english || x.meaning || "").toString(),
      pos: (x.pos || "").toString()
    })).filter(x => x.word && x.meaning);
  } catch (e) {
    console.warn("Bluskyo JSON fetch failed", e);
    return [];
  }
}

// Simple POS guesser (fallback)
function guessPos(word) {
  if (/する$/.test(word)) return "動詞";
  if (/い$/.test(word)) return "形容詞";
  if (/く$|に$/.test(word)) return "副詞";
  return "名詞";
}

// Build MCQ items
function buildQuestions(entries, limit) {
  // sanitize
  let items = entries
    .map(e => ({
      word: e.word.trim(),
      meaning: e.meaning.trim(),
      pos: e.pos ? e.pos : guessPos(e.word.trim())
    }))
    .filter(e => e.word && e.meaning);

  // dedupe by word
  items = uniqBy(items, e => e.word);

  // Limit
  if (limit && items.length > limit) items = items.slice(0, limit);

  // build questions
  const meaningsPool = items.map(i => i.meaning);
  const questions = items.map((it, idx) => {
    // pick 3 wrong meanings that are not equal to correct
    const wrongs = [];
    let tries = 0;
    while (wrongs.length < 3 && tries < 50) {
      const m = meaningsPool[Math.floor(Math.random() * meaningsPool.length)];
      if (m && m !== it.meaning && !wrongs.includes(m)) wrongs.push(m);
      tries++;
    }
    const choices = shuffle([it.meaning, ...wrongs]);
    return {
      id: idx + 1,
      prompt: `語の英訳はどれ？「${it.word}」`,
      choices,
      answerIndex: choices.indexOf(it.meaning),
      word: it.word,
      pos: it.pos
    };
  });

  return questions;
}

// --- UI / Quiz logic ---
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const categorySelect = document.getElementById("categorySelect");
const limitInput = document.getElementById("limitInput");
const quizCard = document.getElementById("quizCard");
const questionEl = document.getElementById("question");
const choicesEl = document.getElementById("choices");
const progressEl = document.getElementById("progress");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");

let ALL = [];
let QUESTIONS = [];
let INDEX = 0;
let SCORE = 0;
let TIMER = null;
const TIME_LIMIT = 5;

async function loadAll() {
  statusEl.textContent = "データ取得中…（複数ソースから統合）";
  const [a, b, c, d] = await Promise.all([
    fetchJlptApiN1(),
    fetchOpenAnkiN1Csv(),
    fetchElzupJsonN1(),
    fetchBluskyoN1Json(),
  ]);
  const merged = [...a, ...b, ...c, ...d].filter(x => x.word && x.meaning);
  const deduped = uniqBy(merged, x => x.word);
  statusEl.textContent = `取得：${deduped.length}語（重複除去後）`;
  ALL = deduped;
}

function startQuiz() {
  const limit = Math.max(10, Math.min(3000, parseInt(limitInput.value || "3000", 10)));
  const qs = buildQuestions(ALL, limit);
  const sel = categorySelect.value;
  QUESTIONS = sel === "all" ? qs : qs.filter(q => q.pos === sel);
  if (QUESTIONS.length === 0) {
    statusEl.textContent = "この条件では出題できません。カテゴリーや出題数を見直してください。";
    return;
  }
  shuffle(QUESTIONS);
  INDEX = 0;
  SCORE = 0;
  quizCard.classList.remove("hidden");
  renderQuestion();
}

function renderQuestion() {
  const q = QUESTIONS[INDEX];
  progressEl.textContent = `${INDEX + 1} / ${QUESTIONS.length}`;
  questionEl.textContent = q.prompt + `（品詞: ${q.pos}）`;
  choicesEl.innerHTML = "";
  q.choices.forEach((ch, i) => {
    const btn = document.createElement("button");
    btn.className = "bg-blue-100 hover:bg-blue-200 text-left px-4 py-2 rounded";
    btn.textContent = ch;
    btn.onclick = () => {
      clearInterval(TIMER);
      if (i === q.answerIndex) {
        SCORE++;
        btn.classList.add("bg-green-200");
      } else {
        btn.classList.add("bg-red-200");
      }
      setTimeout(next, 500);
    };
    choicesEl.appendChild(btn);
  });
  scoreEl.textContent = `スコア: ${SCORE}`;
  startTimer();
}

function startTimer() {
  let t = TIME_LIMIT;
  timerEl.textContent = t;
  clearInterval(TIMER);
  TIMER = setInterval(() => {
    t--;
    timerEl.textContent = t;
    if (t <= 0) {
      clearInterval(TIMER);
      next();
    }
  }, 1000);
}

function next() {
  INDEX++;
  if (INDEX >= QUESTIONS.length) {
    end();
  } else {
    renderQuestion();
  }
}

function end() {
  quizCard.innerHTML = `<div class="text-center">
    <p class="text-xl font-bold mb-2">終了！</p>
    <p class="mb-2">スコア: ${SCORE} / ${QUESTIONS.length}</p>
    <button class="btn bg-blue-600 text-white" onclick="location.reload()">もう一度</button>
  </div>`;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  await loadAll();
  startQuiz();
  startBtn.disabled = false;
});