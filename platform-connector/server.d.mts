export type Session = { code: string; token?: string; playerId?: string; secret?: string; memberId?: number };
export type Command = { v: 1; game: string; operation: 'inspect' | 'admit'; room: string; uid: string; name: string; proof: Session; inviter?: string; instance?: string; invitation?: string };
export type Snapshot = { code: string; instance: string; capacity: number; count: number; status: 'open' | 'started' | 'closed'; ownerUid?: string | null };
export type Adapter = { inspect(c: Command): Snapshot | Promise<Snapshot>; admit(c: Command): Session | Promise<Session> };
export function verifyCommand(raw: string, signature: string | null, game: string, key?: string, now?: number): Command;
export function connectorResponse(request: Request, game: string, adapter: Adapter): Promise<Response>;
export function contextResponse(request: Request, game: string, adapter: Adapter): Promise<Response>;
export function nodeConnector(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, game: string, adapter: Adapter): Promise<boolean>;
