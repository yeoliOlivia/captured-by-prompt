import { describe,it,expect } from 'vitest';
import { clarifiedDraft } from './context-draft';
const draft={kind:'person' as const,name:'Alex',qualifier:'from school',aliases:['Alexander'],notes:'',photoIds:['a'.repeat(64)],isMe:false,startDate:'',endDate:''};
describe('mobile clarification memory',()=>{
  it('remembers the original phrase when the user gives it a different display name',()=>{
    const next=clarifiedDraft(draft,{kind:'person',term:'my brother',choices:[]});
    expect(next.aliases).toEqual(['Alexander','my brother']);
    expect(draft.aliases).toEqual(['Alexander']);
    expect(clarifiedDraft(next,{kind:'person',term:'my brother',choices:[]}).aliases).toEqual(next.aliases);
  });
  it('records me explicitly and leaves ordinary edits alone',()=>{
    expect(clarifiedDraft(draft,{kind:'person',term:'me',choices:[]})).toMatchObject({isMe:true,aliases:['Alexander']});
    expect(clarifiedDraft(draft,null)).toBe(draft);
  });
});
