const lesson = require('./content');
// A small provider boundary: a future backend provider can return the same shape.
module.exports = {
 respond({action, message, history}) {
  const text = (message || '').trim().toLowerCase();
  let key = action;
  if (!key) {
   if (text === 'the query is what i need, the key helps match it, and the value is the score.') key = 'partial';
   else if (/^(is (the )?value the score\??|is it the score\??)$/.test(text)) key = 'correction';
   else if (/\b(define|definition|what does .+ mean|what (is|are) (a |the )?(query|key|value))\b/.test(text)) key = 'definition';
   else if (/^(show the technical explanation|show the math|show the maths)$/.test(text)) key = 'technical';
   else if (history.some(item => item.key === 'check') && /^\[?1\s*,\s*6\]?[.!]?$/.test(text)) {
    return {key:'feedback', text:'You got this part: [1, 6] is the correct combined output. Each value was scaled by its weight and then added. You can review the worked answer or continue with the technical explanation.'};
   }
  }
  return { key: lesson[key] ? key : 'fallback', text: lesson[key] || lesson.fallback };
 }
};

