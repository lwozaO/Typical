document.addEventListener("DOMContentLoaded", () => {
  const appDiv = document.getElementById("quiz");
  const timerDiv = document.getElementById("timer");
  let currentQuestionIndex = 0;
  let score = 0;
  let timer;
  const TIME_LIMIT = 10;

  function renderQuestion() {
    const q = vocabData[currentQuestionIndex];
    const choices = shuffle([q.correct, ...q.incorrect]);
    appDiv.innerHTML = `
      <div class="mb-4">
        <p class="text-lg font-semibold">${currentQuestionIndex + 1}. ${q.question}</p>
      </div>
      <div class="grid gap-2">
        ${choices.map(choice => `
          <button class="choice bg-blue-100 hover:bg-blue-200 text-left px-4 py-2 rounded">${choice}</button>
        `).join('')}
      </div>
      <div class="mt-4 text-sm text-gray-600">正解数: ${score} / ${currentQuestionIndex}</div>
    `;
    startTimer();

    document.querySelectorAll(".choice").forEach(btn => {
      btn.addEventListener("click", () => {
        const selected = btn.textContent.trim();
        clearInterval(timer);
        if (selected === q.correct) {
          score++;
          btn.classList.add("bg-green-200");
        } else {
          btn.classList.add("bg-red-200");
        }
        setTimeout(nextQuestion, 600);
      });
    });
  }

  function startTimer() {
    let timeLeft = TIME_LIMIT;
    timerDiv.textContent = `残り時間: ${timeLeft}秒`;
    timer = setInterval(() => {
      timeLeft--;
      timerDiv.textContent = `残り時間: ${timeLeft}秒`;
      if (timeLeft <= 0) {
        clearInterval(timer);
        nextQuestion();
      }
    }, 1000);
  }

  function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < vocabData.length) {
      renderQuestion();
    } else {
      appDiv.innerHTML = `<p class="text-xl font-bold">終了！スコア: ${score} / ${vocabData.length}</p>`;
      timerDiv.textContent = "";
    }
  }

  renderQuestion();
});

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}