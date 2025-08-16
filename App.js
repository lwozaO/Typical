
export default function App() {
  const [questions, setQuestions] = React.useState([]);
  const [index, setIndex] = React.useState(0);
  const [selected, setSelected] = React.useState(null);

  React.useEffect(() => {
    fetch("./n1_vocab_4choice_1800_full.json")
      .then(res => res.json())
      .then(setQuestions);
  }, []);

  if (questions.length === 0) return React.createElement('p', null, '読み込み中...');

  const q = questions[index];
  const onSelect = (i) => setSelected(i);
  const isCorrect = selected === q.answerIndex;

  return React.createElement('div', { className: 'max-w-xl mx-auto' },
    React.createElement('h1', { className: 'text-xl font-bold mb-2' }, 'JLPT N1 語彙テスト（全1800問）'),
    React.createElement('p', { className: 'mb-4 text-sm text-gray-600' }, `問題 ${index + 1} / ${questions.length}`),
    React.createElement('div', { className: 'mb-4 p-4 bg-white rounded shadow' },
      React.createElement('p', { className: 'font-medium mb-2' }, q.prompt),
      q.choices.map((choice, i) =>
        React.createElement('button', {
          key: i,
          onClick: () => onSelect(i),
          disabled: selected !== null,
          className:
            'block w-full text-left px-4 py-2 my-1 rounded border ' +
            (selected === null ? 'hover:bg-gray-100' :
              i === q.answerIndex ? 'bg-green-100 border-green-500' :
              i === selected ? 'bg-red-100 border-red-500' : 'bg-gray-50')
        }, choice)
      ),
      selected !== null &&
        React.createElement('div', { className: 'mt-4 text-sm text-gray-600' },
          isCorrect ? '正解！' : '不正解...',
          React.createElement('div', null, q.explanation)
        )
    ),
    React.createElement('div', { className: 'text-center' },
      React.createElement('button', {
        className: 'mt-4 px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50',
        onClick: () => { setIndex(index + 1); setSelected(null); },
        disabled: index >= questions.length - 1
      }, '次の問題へ')
    )
  );
}
