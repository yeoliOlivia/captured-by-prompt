import type { Memory } from './context.js';
import type { openTripStudio } from './trip-studio.js';

// Adapt confirmed trip facts to the existing context engine without copying them
// into global personal memory. Unknown identities stay unknown in other trips.
export function studioSearchContext(data: ReturnType<ReturnType<typeof openTripStudio>['details']>) {
  const confirmed = new Map(data.photos.map(photo => [photo.id,
    (photo.annotation?.members ?? []).filter(member => member.status === 'confirmed').map(member => member.memberId)]));
  const available = new Set(data.photos.map(photo => photo.id));
  const memories: Memory[] = data.trip.members.map(member => ({
    id:member.id, kind:'person', name:member.name, qualifier:member.qualifier, aliases:[],
    notes:'Trip member. Reference images may contain several people; do not guess which face is this person. Confirmed candidate associations are supplied separately.',
    photoIds:[...new Set([...member.referencePhotoIds.filter(id=>available.has(id)),
      ...data.photos.filter(photo=>confirmed.get(photo.id)?.includes(member.id)).map(photo=>photo.id)])].slice(0,24),
    isMe:false, startDate:'',endDate:'', memberIds:[], revision:data.trip.revision,
    createdAt:data.trip.createdAt,updatedAt:data.trip.updatedAt,source:'user',
  }));
  return {memories,photoIds:[...available],revision:data.trip.revision,
    confirmedPeople:(photoId:string) => [...new Set([...(confirmed.get(photoId) ?? []),
      ...data.trip.members.filter(member=>member.referencePhotoIds.includes(photoId)).map(member=>member.id)])]};
}
