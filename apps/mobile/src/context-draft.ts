import type { MemoryDraft, Question } from '@captured/core/current';

// Remember the phrase being clarified even when the user supplies a different display name.
export function clarifiedDraft(draft:MemoryDraft, question:Question|null):MemoryDraft {
  if(!question)return draft;
  return {...draft,isMe:question.term==='me'||draft.isMe,
    aliases:question.term==='me'?draft.aliases:[...new Set([...draft.aliases,question.term])]};
}
