// The server owns history; the browser keeps only a temporary session ID and UI state.
const conversation = document.querySelector('#conversation');
const controls = document.querySelector('#controls');
const input = document.querySelector('#message');
const statusText = document.querySelector('#request-status');
const retryButton = document.querySelector('#retry');
let sessionId = null;
let busy = false;
let failedOperation = null;
let expired = false;

async function post(path, body, withSession = true) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 10000);
 try {
  const headers = { 'Content-Type': 'application/json' };
  if (withSession) headers['X-Session-Id'] = sessionId;
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  const data = await response.json();
  if (!response.ok) {
   const error = new Error(data.error || `Request failed (${response.status}).`);
   error.status = response.status;
   throw error;
  }
  return data;
 } finally { clearTimeout(timer); }
}
function setBusy(value) {
 busy = value;
 document.querySelector('#demo').setAttribute('aria-busy', String(value));
 document.querySelectorAll('#demo button, #demo textarea').forEach(element => { element.disabled = value; });
}
async function run(operation) {
 if (busy) return;
 setBusy(true);
 retryButton.hidden = true;
 statusText.textContent = operation.reset ? 'Clearing this scripted session…' : 'Getting a scripted reply…';
 try {
  if (!sessionId) {
   const data = await post('/api/session', {}, false);
   if (typeof data.sessionId !== 'string') throw new Error('Invalid session response.');
   sessionId = data.sessionId;
  }
  const data = await post(operation.reset ? '/api/reset' : '/api/chat', operation.body);
  if (operation.reset) {
   if (data.reset !== true) throw new Error('Invalid reset response.');
   clearInterface();
  } else {
   if (data.scripted !== true || typeof data.reply?.key !== 'string' || typeof data.reply?.text !== 'string') throw new Error('Invalid scripted response.');
   // Append only after success so retrying never duplicates visible messages.
   add('learner', operation.message);
   add('tutor', data.reply.text, data.reply.key);
   if (operation.start) {
    document.querySelector('#starts').hidden = true;
    document.querySelector('#prior').hidden = true;
    controls.hidden = false;
   }
   if (operation.fromInput && input.value.trim() === operation.message) input.value = '';
  }
  failedOperation = null;
  statusText.textContent = '';
 } catch (error) {
  expired = error.status === 410;
  failedOperation = operation;
  statusText.textContent = expired ? error.message : `Could not get a scripted reply. ${error.status ? error.message : 'Check that the Node server is running, then retry.'} Your input has been kept.`;
  retryButton.hidden = expired;
 } finally {
  setBusy(false);
  // Resolve an uncertain request by retrying it or resetting before sending a new one.
  if (failedOperation) {
   document.querySelectorAll('#demo button').forEach(button => {
    if (button.id !== 'reset' && button.id !== 'retry') button.disabled = true;
   });
  } else if (operation.reset) document.querySelector('[data-start]').focus();
  else if (operation.start) document.querySelector('#demo').focus({preventScroll: true});
  else if (operation.fromInput) input.focus();
 }
}
function chat(action, message, options = {}) {
 if (busy || failedOperation) return;
 const body = { requestId: crypto.randomUUID(), message };
 if (action) body.action = action;
 return run({ body, message, ...options });
}
function clearInterface() {
 conversation.replaceChildren();
 controls.hidden = true;
 document.querySelector('#starts').hidden = false;
 document.querySelector('#prior').hidden = true;
 document.querySelector('#knowledge').value = '';
 input.value = '';
 expired = false;
}
function add(role, text, key) {

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
  if (busy || failedOperation) return;
  if (!action) { input.focus(); return; }
  const message = action === 'partial' ? 'The query is what I need, the key helps match it, and the value is the score.' : label.replace('Sample: ', '');
  chat(action, message);
 });
 document.querySelector('#actions').append(button);
}
document.querySelectorAll('[data-start]').forEach(button => button.addEventListener('click', () => {
 if (busy || failedOperation) return;
 if (button.dataset.start === 'scratch') chat('story', 'Explain query, key and value from scratch.', { start: true });
 else {
  document.querySelector('#starts').hidden = true;
  document.querySelector('#prior').hidden = false;
  document.querySelector('#knowledge').focus();
 }
}));
document.querySelector('#prior').addEventListener('submit', event => {
 event.preventDefault();
 const prior = document.querySelector('#knowledge').value.trim();
 chat('story', prior ? `I know a little. ${prior}` : 'I know a little. Skip the opening question.', { start: true });
});
document.querySelector('#message-form').addEventListener('submit', event => {
 event.preventDefault();
 const message = input.value.trim();
 if (message) chat(null, message, { fromInput: true });
});
retryButton.addEventListener('click', () => {
 if (failedOperation && !busy) run(failedOperation);
});
document.querySelector('#reset').addEventListener('click', () => {
 if (busy) return;
 if (expired || !sessionId) {
  sessionId = null;
  failedOperation = null;
  clearInterface();
  statusText.textContent = '';
  retryButton.hidden = true;
  setBusy(false);
  document.querySelector('[data-start]').focus();
  return;
 }
 run({ reset: true, body: { requestId: crypto.randomUUID() } });
});
