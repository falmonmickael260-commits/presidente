import { connectorResponse } from '../../../../../platform-connector/server.mjs';
import { adapter } from '@/server/platformConnector';
export async function POST(request: Request) { return connectorResponse(request, 'president', adapter); }
