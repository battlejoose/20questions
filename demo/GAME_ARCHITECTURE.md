# The Keeper game architecture

This version deliberately uses a custodial server wallet instead of a custom Solana program. The
server is already trusted to choose the secret, call the referee, and decide an exact winning guess,
so a smart contract would add deployment and audit work without removing that central trust.

The OpenAI referee is mandatory. Server startup performs a live referee probe and fails closed when
the API key, selected model, or Responses API is unavailable. There is no deterministic gameplay
fallback. A runtime referee failure does not consume a question or add to the pot; a confirmed
mainnet payment is returned by the treasury before the request fails.

## Round lifecycle

1. The server chooses a secret and a random 32-byte salt.
2. It computes `SHA-256("20Q:SECRET:v1:<roundId>:<normalizedSecret>:<salt>")`.
3. In simulation it creates a synthetic commitment signature. In mainnet it sends the hash through
   the Memo Program before accepting a question.
4. A player reserves a question slot. Simulation confirms a fake 0.01 SOL payment immediately.
   Mainnet returns the treasury address and exact lamport amount to the connected browser wallet.
5. The server verifies the finalized System Program transfer, prevents signature reuse, and only then
   sends an ordinary question to the AI referee or checks an exact guess itself.
6. The accepted answer is broadcast to every browser. Each client speaks the same text through its
   talking head.
7. On a correct guess the server writes the secret and salt through the Memo Program, pays the pot
   from its treasury wallet, and exposes the reveal so every browser can recompute the commitment.

Pending payment reservations expire after five minutes and hold one of the twenty question slots.
A finalized payment arriving after the reservation or round ends is sent back by the treasury.

## Mainnet activation

Copy `.env.example` to `.env`, then set all of the following:

```dotenv
PAYMENT_MODE=mainnet
OPENAI_API_KEY=your-server-only-project-key
MAINNET_TRANSACTIONS_ENABLED=true
SOLANA_RPC_URL=https://your-mainnet-rpc.example
SOLANA_TREASURY_MNEMONIC=your twelve or twenty-four words
SOLANA_TREASURY_ADDRESS=optional-derived-address-assertion
```

The mnemonic remains server-only, is derived in memory at startup using
`m/44'/501'/0'/0'`, and is never returned by an API or logged. The `.env` file and local game data
are ignored by Git. Use a dedicated low-balance game treasury rather than a personal wallet.

Starting in mainnet mode immediately spends a small fee to publish the current round commitment.
Keep `PAYMENT_MODE=simulation` until the treasury, RPC, refund, and payout flows have been exercised
with intentionally small funds.
