import { observerResponse } from '../../../../../admin-observer/server.mjs';
import { findRoom } from '@/server/store';
import { buildPlayerView } from '@/game/view';
export async function POST(request: Request) {
  return observerResponse(request,'president',async(code,instance)=>{
    const room=await findRoom(code);
    if(!room||`${room.code}:${room.state.createdAt}`!==instance)return null;
    return buildPlayerView(room.state,null,Date.now());
  });
}
