// State lives in this tab only. Render all messages as text, never as HTML.
const history = [];
const conversation = document.querySelector('#conversation');
const controls = document.querySelector('#controls');
const input = document.querySelector('#message');
function add(role, text, key) {
 history.push({role, text, key});
 const card = document.createElement('article');
 card.className = role;
 const label = document.createElement('h3');
 label.textContent = role === 'learner' ? 'You' : 'Tutor · scripted reply';
 card.append(label);
 // Presentation only: retain the provider's text and expose the story structure.
 if (key === 'story') {
  const paragraphs = text.split(/\r?\n\s*\r?\n/);
  appendPart('The library story', paragraphs.slice(0, 2));
  appendPart('Connect it to the concept', [paragraphs[2]]);
  appendPart('Where the analogy stops', [paragraphs[3]], 'limitation');
 } else {
  const titles = {check: 'Optional understanding check', technical: 'Real terms and a worked example', partial: 'What to keep and what to fix', correction: 'Separate information from the score', answer: 'Worked answer'};
  appendPart(titles[key], [text]);
 }
 function appendPart(title, paragraphs, className = '') {
  const part = document.createElement('div');
  part.className = `lesson-part ${className}`;
  if (title) {
   const heading = document.createElement('h4');
   heading.textContent = title;
   part.append(heading);
  }
  for (const paragraph of paragraphs) {
   const body = document.createElement('p');
   body.textContent = paragraph;
   part.append(body);
  }
  card.append(part);
 }
 conversation.append(card);
}
function respond(action, message) {
 const reply = window.scriptedProvider.respond({action, message, history});
 add('tutor', reply.text, reply.key);
}
const choices = [
 ['Ask a question', null],
 ['Give me a quick check', 'check'],
 ['Let me explain it back', 'explain'],
 ['Show the technical explanation', 'technical'],
 ['Sample: Is the value the score?', 'correction'],
 ['Sample: partly correct explain-back', 'partial'],
 ['Reveal worked answer', 'answer'],
 ['Skip check / review story', 'story']
];
for (const [label, action] of choices) {
 const button = document.createElement('button');
 button.className = 'secondary';
 button.textContent = label;
 button.addEventListener('click', () => {
  if (!action) { input.focus(); return; }
  const message = action === 'partial' ? 'The query is what I need, the key helps match it, and the value is the score.' : label.replace('Sample: ', '');
  add('learner', message);
  respond(action);
 });
 document.querySelector('#actions').append(button);
}
function start(prior) {
 document.querySelector('#starts').hidden = true;
 document.querySelector('#prior').hidden = true;
 controls.hidden = false;
 if (prior) add('learner', prior);
 respond('story');
 document.querySelector('#demo').focus({preventScroll: true});
}
document.querySelectorAll('[data-start]').forEach(button => button.addEventListener('click', () => {
 if (button.dataset.start === 'scratch') start('Explain query, key and value from scratch.');
 else {
  document.querySelector('#starts').hidden = true;
  document.querySelector('#prior').hidden = false;
  document.querySelector('#knowledge').focus();
 }
}));
document.querySelector('#prior').addEventListener('submit', event => {
 event.preventDefault();
 const prior = document.querySelector('#knowledge').value.trim();
 start(prior ? `I know a little. ${prior}` : 'I know a little. Skip the opening question.');
});
document.querySelector('#message-form').addEventListener('submit', event => {
 event.preventDefault();
 const message = input.value.trim();
 if (!message) return;
 add('learner', message);
 respond(null, message);
 input.value = '';
 input.focus();
});
document.querySelector('#reset').addEventListener('click', () => {
 history.length = 0;
 conversation.replaceChildren();
 controls.hidden = true;
 document.querySelector('#starts').hidden = false;
 document.querySelector('#prior').hidden = true;
 document.querySelector('#knowledge').value = '';
 input.value = '';
 document.querySelector('[data-start]').focus();
});

