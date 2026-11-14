// Integer slider ticks keep complementary weights and displayed sums predictable.
export function calculateAttention(ticks) {
 const first = Math.max(0, Math.min(100, Number.isFinite(Number(ticks)) ? Math.round(Number(ticks)) : 80));
 const second = 100 - first;
 return { weights: [first / 100, second / 100], contributions: [[first / 10, 0], [0, second / 10]], output: [first / 10, second / 10] };
}
export const vectorText = vector => `[${vector.join(', ')}]`;
