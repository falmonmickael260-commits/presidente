import type { IncomingMessage, ServerResponse } from 'node:http';
export type ObserverSnapshot=(room:string,instance:string)=>unknown|Promise<unknown>;
export function verifyObserver(raw:string,signature:unknown,game:string,key?:string,now?:number):{v:1;game:string;operation:'snapshot';actor:string;access:string;room:string;instance:string};
export function observerResponse(request:Request,game:string,snapshot:ObserverSnapshot,key?:string):Promise<Response>;
export function nodeObserver(req:IncomingMessage,res:ServerResponse,game:string,snapshot:ObserverSnapshot,key?:string):Promise<boolean>;
