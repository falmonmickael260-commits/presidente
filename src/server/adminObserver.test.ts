import { expect,it } from 'vitest';
import { createHmac,randomUUID } from 'node:crypto';
import { createRoom,joinRoom } from './store';
import { POST } from '../app/api/platform/observer/route';
it('observer : aucune place ni main privée, signature et instance contrôlées',async()=>{
  const previous=process.env.PLATFORM_SHARED_SECRET;process.env.PLATFORM_SHARED_SECRET='local-observer-test-key';
  try{
    const room=createRoom();joinRoom(room,'Alice','🎲');joinRoom(room,'Bob','🎲');
    room.state.players[0].hand=[{id:'PRIVATE-CARD',rank:3,suit:'C'}];
    const before=JSON.stringify(room.state),tokens=room.tokens.size;
    const cmd={v:1,game:'president',operation:'snapshot',actor:randomUUID(),access:randomUUID(),room:room.code,instance:`${room.code}:${room.state.createdAt}`};
    async function observe(instance=cmd.instance,valid=true){const raw=JSON.stringify({...cmd,instance}),stamp=String(Math.floor(Date.now()/1000));const signature=`${stamp}.${createHmac('sha256',process.env.PLATFORM_SHARED_SECRET!).update(`rg-admin-observer-v1.${stamp}.${raw}`).digest('hex')}`;
      return POST(new Request('https://game.test/api/platform/observer',{method:'POST',headers:{'x-rg-signature':valid?signature:'forged'},body:raw}));}
    const response=await observe();expect(response.status).toBe(200);
    const body=await response.json();expect(body.publicState.players).toHaveLength(2);expect(body.publicState.hand).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('PRIVATE-CARD');expect(JSON.stringify(room.state)).toBe(before);expect(room.tokens.size).toBe(tokens);
    expect((await observe('old-instance')).status).toBe(404);expect((await observe(cmd.instance,false)).status).toBe(403);
  }finally{if(previous===undefined)delete process.env.PLATFORM_SHARED_SECRET;else process.env.PLATFORM_SHARED_SECRET=previous;}
});
