import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { AuthService } from './auth.js';
import { GameService, GameUnavailableError } from './GameService.js';
import { OpenAiReferee } from './referee.js';
import { JsonGameStore } from './store.js';
import { SimulatedPaymentProvider } from './payments/SimulatedPaymentProvider.js';
import { MainnetPaymentProvider } from './payments/MainnetPaymentProvider.js';
import type { PaymentProvider } from './payments/PaymentProvider.js';
import type { PlayerSession, QuestionKind } from './types.js';

const store = new JsonGameStore(
  config.dataFile,
  config.questionPriceLamports,
  config.initialTurns,
);
const auth = new AuthService(config.publicOrigin);
const payments: PaymentProvider =
  config.paymentMode === 'mainnet'
    ? new MainnetPaymentProvider({
        rpcUrl: config.solanaRpcUrl,
        mnemonic: config.solanaTreasuryMnemonic as string,
        derivationPath: config.solanaTreasuryDerivationPath,
        expectedTreasuryAddress: config.solanaTreasuryAddress,
        platformFeeBps: config.platformFeeBps,
      })
    : new SimulatedPaymentProvider();
const referee = new OpenAiReferee(config.openAiApiKey as string, config.openAiModel);
const game = new GameService(store, payments, referee);

await game.initialize();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    const status = error instanceof GameUnavailableError
      ? error.status
      : message === 'Authentication required.'
        ? 401
        : 400;
    json(response, status, {
      error: message,
      refundSignature: error instanceof GameUnavailableError ? error.refundSignature : undefined,
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`20 Questions game server listening on http://${config.host}:${config.port}`);
  console.log(`Payment mode: ${payments.mode}`);
  if (payments.treasuryAddress) console.log(`Treasury: ${payments.treasuryAddress}`);
  console.log(`Referee: ${config.openAiModel} (readiness verified)`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  if (method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, {
      ok: true,
      mode: payments.mode,
      ai: 'ready',
      model: config.openAiModel,
    });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/config') {
    json(response, 200, {
      paymentMode: payments.mode,
      questionPriceLamports: config.questionPriceLamports,
      treasuryAddress: payments.treasuryAddress,
      walletRequired: payments.mode === 'mainnet',
      network: payments.mode === 'mainnet' ? 'mainnet-beta' : 'simulation',
      refereeMode: 'openai',
      refereeModel: config.openAiModel,
    });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/round') {
    json(response, 200, game.publicRound);
    return;
  }
  if (method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      ...corsHeaders(),
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    response.write(eventPayload(game.publicRound));
    const unsubscribe = game.subscribe((round) => response.write(eventPayload(round)));
    const keepAlive = setInterval(() => response.write(': keepalive\n\n'), 20_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/guest') {
    if (payments.mode !== 'simulation') throw new Error('Guest sign-in is disabled on mainnet.');
    const session = auth.createGuest();
    json(response, 201, publicSession(session));
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/challenge') {
    const body = await readJson<{ address?: string }>(request);
    const challenge = auth.createChallenge(body.address ?? '');
    json(response, 201, challenge);
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/verify') {
    const body = await readJson<{
      address?: string;
      message?: string;
      signatureBase64?: string;
      publicKeyBase64?: string;
    }>(request);
    const session = auth.verifyChallenge({
      address: body.address ?? '',
      message: body.message ?? '',
      signatureBase64: body.signatureBase64 ?? '',
      publicKeyBase64: body.publicKeyBase64 ?? '',
    });
    json(response, 201, publicSession(session));
    return;
  }
  if (method === 'POST' && url.pathname === '/api/questions/reserve') {
    const session = requireSession(request);
    const body = await readJson<{ kind?: QuestionKind; text?: string }>(request);
    const result = await game.reserve(session, {
      kind: body.kind ?? 'ask',
      text: body.text ?? '',
    });
    json(response, result.entry ? 201 : 202, result);
    return;
  }
  if (method === 'POST' && url.pathname === '/api/questions/confirm') {
    const session = requireSession(request);
    const body = await readJson<{ reservationId?: string; signature?: string }>(request);
    const result = await game.confirm(session, body.reservationId ?? '', body.signature ?? '');
    json(response, 201, result);
    return;
  }
  json(response, 404, { error: 'Not found.' });
}

function requireSession(request: IncomingMessage): PlayerSession {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const session = auth.resolve(authorization);
  if (!session) throw new Error('Authentication required.');
  return session;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 16_384) throw new Error('Request body is too large.');
  }
  try {
    return JSON.parse(body || '{}') as T;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': config.publicOrigin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
}

function publicSession(session: PlayerSession): Omit<PlayerSession, 'expiresAt'> & { expiresAt: string } {
  return { ...session, expiresAt: new Date(session.expiresAt).toISOString() };
}

function eventPayload(round: unknown): string {
  return `event: round\ndata: ${JSON.stringify(round)}\n\n`;
}
