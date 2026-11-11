import { describe, it, expect } from 'vitest';
import { BenchmarkManifestSchema, mean, ndcgAt, recallAt, reciprocalRank, verdictAgreement } from './benchmark';

describe('benchmark metrics',()=>{
 it('scores rankings against labels',()=>{
  const ranked=['a','b','c','d'];
  expect(recallAt(ranked,['b','z'],2)).toBe(0.5);
  expect(reciprocalRank(ranked,['c'])).toBeCloseTo(1/3);
  expect(reciprocalRank(ranked,['z'])).toBe(0);
  expect(ndcgAt(ranked,['a'],10)).toBe(1);
  expect(ndcgAt(ranked,['b'],10)).toBeCloseTo(1/Math.log2(3));
  expect(recallAt(ranked,[],10)).toBeUndefined();
  expect(mean([1,undefined,0])).toBe(0.5);
 });
 it('counts visual-check agreement and keeps uncertainty separate',()=>{
  expect(verdictAgreement([{id:'a',verdict:'match'},{id:'b',verdict:'match'},{id:'c',verdict:'mismatch'},{id:'d',verdict:'uncertain'}],['a'])).toEqual({correct:2,wrong:1,uncertain:1});
 });
 it('rejects manifests whose labels name unknown photos',()=>{
  expect(()=>BenchmarkManifestSchema.parse({photos:[{id:'a',path:'a.jpg'},{id:'b',path:'b.jpg'}],queries:[{id:'q',query:'x',relevant:['c']}]})).toThrow(/unknown photo c/);
 });
});
