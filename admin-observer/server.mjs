// Server-only protocol. Observers never create a player, session or game action.
import { createHmac, timingSafeEqual } from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function verifyObserver(raw,signature,game,key=process.env.PLATFORM_SHARED_SECRET,now=Date.now()){
  if(!key||typeof signature!=='string'||raw.length>2048)throw Error('Accès spectateur refusé.');
  const [stamp,hex,...extra]=signature.split('.');
  if(extra.length||!/^\d{10}$/.test(stamp||'')||!/^[a-f0-9]{64}$/.test(hex||'')||Math.abs(now/1000-Number(stamp))>15)throw Error('Autorisation expirée.');
  const expected=createHmac('sha256',key).update(`rg-admin-observer-v1.${stamp}.${raw}`).digest();
  if(!timingSafeEqual(expected,Buffer.from(hex,'hex')))throw Error('Accès spectateur refusé.');
  const command=JSON.parse(raw);
  if(command.v!==1||command.game!==game||command.operation!=='snapshot'||!uuid.test(command.actor)||!uuid.test(command.access)
    ||typeof command.room!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(command.room)
    ||typeof command.instance!=='string'||command.instance.length>160)throw Error('Commande invalide.');
  return command;
}
export async function observerResponse(request,game,snapshot,key=process.env.PLATFORM_SHARED_SECRET){
  if(request.method!=='POST')return Response.json({error:'Méthode refusée.'},{status:405});
  try{
    let size=0;const chunks=[];const reader=request.body?.getReader();
    if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();throw Error('Commande trop volumineuse.');}chunks.push(value);}}finally{reader.releaseLock();}
    const command=verifyObserver(Buffer.concat(chunks).toString('utf8'),request.headers.get('x-rg-signature'),game,key);
    const data=await snapshot(command.room,command.instance);
    if(!data) return Response.json({error:'Ce salon est fermé ou a été remplacé.'},{status:404,headers:{'cache-control':'no-store'}});
    return Response.json({game,room:command.room,instance:command.instance,observedAt:new Date().toISOString(),publicState:data},
      {headers:{'cache-control':'no-store'}});
  }catch{return Response.json({error:'Accès spectateur refusé.'},{status:403,headers:{'cache-control':'no-store'}});}
}
export async function nodeObserver(req,res,game,snapshot,key=process.env.PLATFORM_SHARED_SECRET){
  if(new URL(req.url||'/','http://localhost').pathname!=='/api/platform/observer')return false;
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>2048){res.writeHead(413);res.end();return true;}chunks.push(chunk);}
  const response=await observerResponse(new Request('http://localhost/api/platform/observer',{
    method:req.method||'POST',headers:{'x-rg-signature':String(req.headers['x-rg-signature']||'')},
    ...(['GET','HEAD'].includes(req.method||'')?{}:{body:Buffer.concat(chunks)}),
  }),game,snapshot,key);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return true;
}
