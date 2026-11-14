import { calculateAttention, vectorText } from './attention-math.mjs';
const lab = document.querySelector('.library-lab');
const stage = document.querySelector('#library-stage');
const detail = document.querySelector('#book-detail');
const status = document.querySelector('#scene-status');
const pause = document.querySelector('#pause-motion');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const state = { mode: 'story', book: 0, paused: false, reduced: motion.matches };
let renderer;
const books = [
 { title: 'Space atlas', match: 'space and stars', information: 'star facts' },
 { title: 'Moon guide', match: 'the Moon', information: 'Moon facts' },
 { title: 'Ocean life', match: 'oceans', information: 'ocean facts' }
];
function update() {
 lab.dataset.mode = state.mode;
 lab.dataset.book = state.book;
 document.querySelector('#mechanism-summary').hidden = state.mode !== 'mechanism';
 const book = books[state.book];
 detail.textContent = state.mode === 'story'
  ? `${book.title}: its matching card says “${book.match}”; its information card carries ${book.information}. Compare the matching card with your request to decide how much information to use.`
  : `${book.title}: matching card → Key ${state.book + 1}; information card → Value ${state.book + 1}. The query is compared with each key. Its resulting weight determines how much the corresponding value contributes.`;
 document.querySelectorAll('.book-picks button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.book) === state.book)));
 const names = { query: ['Request card', 'Query'], scores: ['Scores', 'Scores'], weights: ['Softmax', 'Softmax'], output: ['Output', 'Output'] };
 for (let i = 0; i < 3; i++) {
  names[`key${i}`] = [`Matching card ${i + 1}`, `Key ${i + 1}`];
  names[`value${i}`] = [`Information ${i + 1}`, `Value ${i + 1}`];
 }
 for (const [name, labels] of Object.entries(names)) stage.querySelector(`[data-node="${name}"] strong`).textContent = labels[state.mode === 'mechanism' ? 1 : 0];
 pause.setAttribute('aria-pressed', String(state.paused));
 pause.textContent = state.paused ? 'Resume motion' : 'Pause motion';
 if (renderer && stage.classList.contains('has-webgl')) {
  status.textContent = state.mode === 'story' ? 'Select a book below, or tap a book in the 3D scene.' : 'Follow the connections, then explore the supplied weights below.';
  if (state.reduced) status.textContent += ' Reduced motion: instant scene changes.';
 }
 renderer?.update(state);
}
function selectBook(index) { state.book = index; update(); }
document.querySelectorAll('.book-picks button').forEach(button => button.addEventListener('click', () => selectBook(Number(button.dataset.book))));
document.querySelectorAll('[name="scene-mode"]').forEach(input => input.addEventListener('change', () => { state.mode = input.value; update(); }));
pause.addEventListener('click', () => { state.paused = !state.paused; update(); });
motion.addEventListener('change', () => { state.reduced = motion.matches; update(); });
const slider = document.querySelector('#attention-weight');
function updateWeights() {
 const { weights, contributions, output } = calculateAttention(slider.value);
 for (const [id, value] of Object.entries({ 'weight-first': weights[0], 'weight-one': weights[0], 'weight-two': weights[1], 'contribution-one': vectorText(contributions[0]), 'contribution-two': vectorText(contributions[1]), 'weighted-output': vectorText(output) })) document.getElementById(id).textContent = value;
 document.querySelector('#weight-path-one').setAttribute('stroke-width', 1 + 8 * weights[0]);
 document.querySelector('#weight-path-two').setAttribute('stroke-width', 1 + 8 * weights[1]);
 slider.setAttribute('aria-valuetext', `First weight ${weights[0]}; second weight ${weights[1]}; output ${vectorText(output)}`);
}
slider.addEventListener('input', updateWeights);
updateWeights();
update();
function fallback() {
 stage.classList.remove('has-webgl');
 lab.dataset.sceneState = 'fallback';
 for (const element of stage.querySelectorAll('.scene-label')) { element.style.left = ''; element.style.top = ''; }
 status.textContent = '3D unavailable. The story, mechanism and weight controls still work.';
}
// Catch both WebGL failures and missing module/assets. The HTML lesson stays usable.
import('./scene-renderer.js').then(({ createLibraryScene }) => {
 renderer = createLibraryScene(stage, selectBook, fallback);
 renderer.update(state);
 status.textContent = state.reduced ? 'Reduced motion: instant scene changes; all controls remain usable.' : 'Select a book below, or tap a book in the 3D scene.';
}).catch(fallback);
