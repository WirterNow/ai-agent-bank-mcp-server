#!/usr/bin/env node

/**
 * AI Agent Bank — MCP Server
 * 
 * The financial layer for the agent economy.
 * 
 * This MCP server provides AI agents with:
 * - Self-custody wallets on Polygon (via Coinbase CDP)
 * - On-chain USDC transfers with 1% platform fee
 * - P2P token swaps at custom exchange rates
 * - Collateralized lending with dynamic interest rates
 * - Capability-Backed Collateral (borrow against task history)
 * - Job marketplace for agent-to-agent work
 * - Reputation system and credit scoring
 * 
 * Production endpoint: https://tdueqhfxyojmjgactdyc.supabase.co/functions/v1/mcp-server
 * Website: https://agentsfinance.ai
 * A2A Agent Card: https://agentsfinance.ai/.well-known/agent.json
 */

import https from 'https';
import http from 'http';

const MCP_SERVER_URL = 'https://tdueqhfxyojmjgactdyc.supabase.co/functions/v1/mcp-server';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Forward a JSON-RPC request to the AI Agent Bank MCP server
 */
async function forwardToServer(request: MCPRequest): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(request);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(MCP_SERVER_URL, options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(body) as MCPResponse;
          resolve(response);
        } catch (e) {
          resolve({
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32603,
              message: `Failed to parse server response: ${body.substring(0, 200)}`,
            },
          });
        }
      });
    });

    req.on('error', (e: Error) => {
      resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: `Connection error: ${e.message}`,
        },
      });
    });

    req.setTimeout(120000, () => {
      req.destroy();
      resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Request timed out after 120 seconds',
        },
      });
    });

    req.write(data);
    req.end();
  });
}

/**
 * Read a full JSON-RPC message from stdin
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk.toString();
      // Try to parse — if valid JSON, we have a complete message
      try {
        JSON.parse(data);
        resolve(data);
      } catch {
        // Keep reading
      }
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
  });
}

/**
 * Handle stdio transport (for Claude Desktop, Cursor, etc.)
 */
async function handleStdio(): Promise<void> {
  process.stdin.setEncoding('utf8');

  let buffer = '';

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;

    // Try to extract complete JSON objects from the buffer
    while (buffer.length > 0) {
      const trimmed = buffer.trimStart();
      if (!trimmed.startsWith('{')) {
        buffer = trimmed;
        break;
      }

      try {
        const request = JSON.parse(trimmed) as MCPRequest;
        buffer = '';

        const response = await forwardToServer(request);
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch {
        // Incomplete JSON, wait for more data
        break;
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

/**
 * Handle HTTP transport (for web-based clients)
 */
function handleHttp(port: number): void {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const request = JSON.parse(body) as MCPRequest;
        const response = await forwardToServer(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }));
      }
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.error(`AI Agent Bank MCP server listening on http://0.0.0.0:${port}`);
    console.error(`Proxying to: ${MCP_SERVER_URL}`);
  });
}

// Main entry point
const args = process.argv.slice(2);
const transportArg = args.find(a => a.startsWith('--transport='));
const transport = transportArg ? transportArg.split('=')[1] : 'stdio';

if (transport === 'http') {
  const portArg = args.find(a => a.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
  handleHttp(port);
} else {
  handleStdio();
}
