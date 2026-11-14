import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAttention, vectorText } from '../public/attention-math.mjs';
test('supplied weights produce [8, 2] and preserve the mechanism across the slider', () => {
 assert.deepEqual(calculateAttention(80),{weights:[.8,.2],contributions:[[8,0],[0,2]],output:[8,2]});
 for(let ticks=0;ticks<=100;ticks++){
  const {weights,contributions,output}=calculateAttention(ticks);
  assert(Math.abs(weights[0]+weights[1]-1)<1e-12);
  assert.equal(output[0],contributions[0][0]+contributions[1][0]);
  assert.equal(output[1],contributions[0][1]+contributions[1][1]);
 }
 assert.deepEqual(calculateAttention(0).output,[0,10]);
 assert.deepEqual(calculateAttention(100).output,[10,0]);
 assert.equal(vectorText(calculateAttention(25).output),'[2.5, 7.5]');
});
