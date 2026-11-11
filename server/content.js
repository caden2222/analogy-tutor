// Teaching content is independent of the page and the response selection rules.
module.exports = {
 story: `Imagine you’re preparing a library display about space. You have a request card describing the information you need. Each book has a matching card and an information card.

You compare your request card with every matching card. Each comparison produces a match score. Those scores become shares that add up to one. A book with a larger share contributes more of its information card to your final combined notes. You combine information from the books rather than simply choosing one winner.

Your request card represents the query. Each matching card represents a key. Each information card represents a value. Match scores determine the shares, called attention weights; the values provide the information being combined.

Limitation: real attention uses lists of numbers and calculations. It does not read book labels or deliberately decide what is useful.`,
 correction: `No. The value is the information card, not the score. Comparing the query with a key produces a score. The scores become attention weights, which control how much each value contributes.\n\nRequest + matching card → score → share. Information card × share → contribution.`,
 partial: `You got this part: the query describes what is needed, and the key helps determine the match.\n\nOne thing to fix: the value carries information; it is separate from the score. In our library, a strong match means taking a larger share of an information card.\n\nNext, try a quick check or see the calculation.`,
 technical: `Literal explanation: queries, keys and values are vectors (lists of numbers). For one query q, compare it with each key k using the scaled dot product: score = q · k / √dₖ, where dₖ is the number of components in the key. Apply softmax across the relevant scores to get attention weights that sum to one. Multiply each value vector by its weight and sum the results.\n\nMathematical example: supplied weights [0.8, 0.2]; values [10, 0] and [0, 10].\n0.8 × [10, 0] + 0.2 × [0, 10] = [8, 0] + [0, 2] = [8, 2].\n\nThese weights are supplied for this example. We have not calculated them from query/key vectors here. Attention weights describe contributions from positions; next-token probabilities describe possible output tokens and are different quantities.`,
 check: `Fresh example: two information cards carry values [4, 0] and [0, 8]. Their supplied attention weights are [0.25, 0.75]. What is the combined output? You can answer freely, skip, or reveal the worked answer.`,
 answer: `Worked answer: 0.25 × [4, 0] + 0.75 × [0, 8] = [1, 0] + [0, 6] = [1, 6]. Each weight scales its corresponding value before the results are added.`,
 definition: `A query is a vector used to compare with keys. A key is a vector used in that comparison to produce a score. A value is a vector of information that is combined using attention weights.\n\nIn the library: request card = query; matching card = key; information card = value.`,
 fallback: `This scripted demo cannot reliably interpret that message. I won’t guess what you understood. Try the sample misconception, review the story, or open the technical explanation. A later LLM version will support flexible follow-ups.`,
 explain: `Explain query, key and value in your own words. For the complete scripted feedback path, try the labelled sample below. Other answers are accepted, but this demo cannot assess them reliably.`
};

