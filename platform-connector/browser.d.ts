export type Session = { code: string; token?: string; playerId?: string; secret?: string; memberId?: number };
export function connectPlatform(options: { game: string; session: () => Session | null; adopt: (session: Session) => void | Promise<void>; platform?: string }): () => void;
