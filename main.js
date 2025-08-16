// ---------- utils ----------
const $ = (id) => document.getElementById(id);
const log = (m) => { const el = $("log"); el.textContent += m + "\n"; el.scrollTop = el.scrollHeight; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shuffle = (arr) => { for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; };
const uniqBy = (arr, key) => { const seen=new Set(); return arr.filter(x=>{ const k=key(x); if(seen.has(k)) return false; seen.add(k); return true; }); };

// fetch with timeout
async function fetchWithTimeout(url, ms=9000, opts={}) {
  const ctrl = new AbortController();
  const id = setTimeout(()=> ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", ...opts });
    return res;
  } finally { clearTimeout(id); }
}

// ---------- data fetchers (CORS-friendly first) ----------
async function fetchOpenAnkiN1Csv() {
  const url = "https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n1.csv";
  log("Fetch OpenAnki CSV ...");
  try {
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new Error(res.status+" "+res.statusText);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const rows = [];
    for (let i=0; i<lines.length; i++) {
      const cols = lines[i].split(",");
      if (!cols[0] || cols[0] === "expression") continue;
      rows.push({
        word: (cols[0]||"").trim(),
        meaning: (cols[2] || cols[3] || "").trim(), // gloss
        pos: (cols[3] || "").trim()
      });
    }
    log(`OpenAnki: ${rows.length} 語`);
    return rows;
  } catch(e) { log("OpenAnki失敗: "+e); return []; }
}

async function fetchElzupJsonN1() {
  const url = "https://raw.githubusercontent.com/elzup/jlpt-word-list/master/out/jlpt-n1.json";
  log("Fetch elzup JSON ...");
  try {
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new Error(res.status);
    const arr = await res.json();
    const out = arr.map(x=>({ word: x.expression || x.word || "", meaning: (x.gloss || x.meaning || "").toString(), pos: (x.pos||"").toString() })).filter(x=>x.word && x.meaning);
    log(`elzup: ${out.length} 語`);
    return out;
  } catch(e) { log("elzup失敗: "+e); return []; }
}

async function fetchBluskyoN1Json() {
  const url = "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/master/N1.json";
  log("Fetch Bluskyo JSON ...");
  try {
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new Error(res.status);
    const arr = await res.json();
    const out = arr.map(x=>({ word: x.kanji || x.kana || "", meaning: (x.english||"").toString(), pos: (x.pos||"").toString() })).filter(x=>x.word && x.meaning);
    log(`Bluskyo: ${out.length} 語`);
    return out;
  } catch(e) { log("Bluskyo失敗: "+e); return []; }
}

// optional API (sometimes CORS blocks on mobile)
async function fetchJlptApiN1() {
  const urlBase = "https://jlpt-vocab-api.vercel.app/api/words?level=1&offset=";
  log("Fetch JLPT API ...");
  let offset=0, limit=500, out=[];
  try {
    for (let k=0;k<8;k++){ // up to 4000
      const res = await fetchWithTimeout(urlBase+offset+"&limit="+limit, 9000);
      if (!res.ok) break;
      const data = await res.json();
      if (!data || !data.words || data.words.length===0) break;
      data.words.forEach(w=> out.push({ word: w.word || w.expression || w.kanji || "", meaning: (w.meaning || w.meanings || "").toString(), pos: (w.pos||"").toString() }));
      log(`JLPT API: +${data.words.length}件`);
      offset += limit;
      await sleep(150);
    }
  } catch(e){ log("JLPT API失敗: "+e); }
  return out;
}

function guessPos(word) {
  if (/する$/.test(word)) return "動詞";
  if (/い$/.test(word)) return "形容詞";
  if (/く$|に$/.test(word)) return "副詞";
  return "名詞";
}

function buildQuestions(entries, limit) {
  let items = entries.map(e=>({ word: e.word.trim(), meaning: e.meaning.trim(), pos: e.pos ? e.pos : guessPos(e.word||"") }))
    .filter(e=>e.word && e.meaning);
  items = uniqBy(items, e=>e.word);
  if (limit && items.length>limit) items = items.slice(0, limit);

  const meanings = items.map(i=>i.meaning);
  return items.map((it, idx)=>{
    const wrongs = [];
    let tries=0;
    while(wrongs.length<3 && tries<60){
      const m = meanings[Math.floor(Math.random()*meanings.length)];
      if (m && m!==it.meaning && !wrongs.includes(m)) wrongs.push(m);
      tries++;
    }
    const choices = shuffle([it.meaning, ...wrongs]);
    return { id: idx+1, word: it.word, pos: it.pos, prompt: `語の英訳はどれ？「${it.word}」`, choices, answerIndex: choices.indexOf(it.meaning) };
  });
}

// ---------- UI / quiz ----------
const statusEl = $("status");
const startBtn = $("startBtn");
const reviewBtn = $("reviewBtn");
const categorySelect = $("categorySelect");
const limitInput = $("limitInput");
const quizCard = $("quizCard");
const questionEl = $("question");
const choicesEl = $("choices");
const progressEl = $("progress");
const timerEl = $("timer");
const scoreEl = $("score");
const posChip = $("posChip");

let ALL = [];
let QUESTIONS = [];
let INDEX = 0;
let SCORE = 0;
let TIMER = null;
let WRONG = []; // for review mode
const TIME_LIMIT = 5;

async function loadAll() {
  statusEl.textContent = "データ取得中…（1/3）";
  const [a,b,c] = await Promise.allSettled([
    fetchOpenAnkiN1Csv(),
    fetchElzupJsonN1(),
    fetchBluskyoN1Json(),
  ]);
  const arr = [];
  for (const r of [a,b,c]) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) arr.push(...r.value);
  }
  // optional API last (may fail on some devices)
  statusEl.textContent = "データ取得中…（2/3 追加ソース）";
  const d = await fetchJlptApiN1();
  if (Array.isArray(d)) arr.push(...d);

  const deduped = uniqBy(arr.filter(x=>x.word && x.meaning), x=>x.word);
  ALL = deduped;
  statusEl.textContent = `取得：${ALL.length}語（重複除去後）。「読み込み＆開始」を押すと出題します。`;
  if (ALL.length < 50) statusEl.textContent += " 取得語彙が少ない場合は回線・CORSの影響かもしれません。少し時間をおいて再試行してください。";
}

function startQuiz(reviewOnly=false) {
  const limit = Math.max(10, Math.min(3000, parseInt(limitInput.value||"3000",10)));
  let qs;
  if (reviewOnly) {
    qs = WRONG.slice(); // use wrong list
  } else {
    qs = buildQuestions(ALL, limit);
    const sel = categorySelect.value;
    qs = sel==="all" ? qs : qs.filter(q=>q.pos===sel);
  }
  if (qs.length === 0) {
    statusEl.textContent = reviewOnly ? "復習する問題がまだありません。" : "この条件では出題できません。";
    return;
  }
  WRONG = []; // reset wrong collector for this run
  QUESTIONS = shuffle(qs);
  INDEX = 0;
  SCORE = 0;
  quizCard.classList.remove("hidden");
  renderQuestion();
}

function renderQuestion() {
  const q = QUESTIONS[INDEX];
  progressEl.textContent = `${INDEX+1} / ${QUESTIONS.length}`;
  questionEl.textContent = q.prompt;
  posChip.textContent = `品詞: ${q.pos}`;
  choicesEl.innerHTML = "";
  q.choices.forEach((ch, i)=>{
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
        WRONG.push(q); // collect wrong one
        reviewBtn.disabled = false;
      }
      setTimeout(next, 450);
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
      // treat timeout as wrong
      WRONG.push(QUESTIONS[INDEX]);
      reviewBtn.disabled = false;
      next();
    }
  }, 1000);
}

function next() {
  INDEX++;
  if (INDEX >= QUESTIONS.length) return end();
  renderQuestion();
}

function end() {
  quizCard.innerHTML = `<div class="text-center space-y-2">
    <p class="text-xl font-bold">終了！</p>
    <p>スコア: ${SCORE} / ${QUESTIONS.length}</p>
    <div class="space-x-2">
      <button class="btn btn-primary" onclick="location.reload()">もう一度</button>
      <button class="btn btn-secondary" id="startReviewNow" ${WRONG.length? "" : "disabled"}>復習モード</button>
    </div>
  </div>`;
  const btn = document.getElementById("startReviewNow");
  if (btn) btn.onclick = ()=> {
    // use stored WRONG and restart quiz
    QUESTIONS = WRONG.slice();
    if (QUESTIONS.length === 0) return;
    INDEX = 0; SCORE = 0; WRONG = [];
    $("quizCard").classList.remove("hidden");
    renderQuestion();
  };
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  $("status").textContent = "取得開始…";
  await loadAll();
  startQuiz(false);
  startBtn.disabled = false;
});

reviewBtn.addEventListener("click", () => startQuiz(true));