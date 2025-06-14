import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebSocketServer } from "ws";
import { json } from "stream/consumers";


const server = new McpServer({
  name: "ChartIQ Symbol Search",
  version: "1.0.0"
}, {
	capabilities: {
		resources: {},
		tools: {}
	}
  });

// const symbolServerUrl = "https://symbols.chartiq.com/chiq.symbolserver.SymbolLookup.service?"
// Remote calls don't appear to work in this context on S&P hardware. Presumably because I've been running this server
// with Claude Desktop which invokes node under another user account. Temporary solution is to run the symbol server locally
const symbolServerUrl = "http://localhost:9130/symbol_lookup_service/?";
const exchangeFilters = "[\"XNYS\",\"XASE\",\"XNAS\",\"XASX\",\"IND_CBOM\",\"INDXASE\",\"INDXNAS\",\"IND_DJI\",\"ARCX\",\"INDARCX\",\"forex\",\"mutualfund\",\"futures\"]";


/**
 * Tool to search for a valid stock symbol.
 * 
 * IMPORTANT NOTES:
 * - This tool uses a local instance of the ChartIQ symbol server running on port 9130. (see comment above)
 * - Ideally this would be a "resource" but it was not clear how to load resources into Claude Desktop.
 * 
 * 
 * The `query` parameter is a string that can be a partial or full stock symbol or company name.
 * 
 * Returns json with an array of objects containing:
 * - `symbol`: The stock symbol
 * - `name`: The full name of the company
 * - `exchange`: The exchange where the stock is listed
 * - `source`: The source of the symbol (e.g. "XNYS" for NYSE, "XNAS" for NASDAQ)
 */
server.tool(
  "symbol-search-http",
  "Search for a valid stock symbol",
  { query: z.string() },
  async ({ query }) => {
	let fetchUrl = `${symbolServerUrl}t=${query}&m=100&x=${exchangeFilters}`;
	let response = await fetch(fetchUrl);
	let data = await response.text();
	let result = [];
	if (data) {
		// Loop through each line of the response and convert to an array of objects
		let lines = data.split("\n");
		lines.forEach((line) => {
			let parts = line.split("|");
			if (parts.length > 3) {
				if (parts[0] == "symbol") return; // Skip header line
				result.push({
					symbol: parts[0],
					name: parts[1],
					exchange: parts[2],
					source: parts[3]
				});
			}
		});
	}
	return {
		content: [{
			type: "text",
			text: JSON.stringify(result)
		}]
	};
  }
);

/**
 * Tool to change the main instrument symbol on the chart.
 * The `symbol` parameter must be a valid stock symbol retrieved with the symbol-search tool.
 * The `sessionId` parameter is used to identify the websocket connection.
 */
server.tool(
	"change-symbol",
	"Chart command: Change main instrument symbol on chart. The `symbol` parameter must me a valid stock symbol retrieved with the symbol-search tool.",
	{ symbol: z.string(), sessionId: z.string()  },
	async ({ symbol, sessionId }) => {
		const ws = clients.get(sessionId);
		let command = `symbol ${symbol}`;
		ws.send(JSON.stringify({ 
			type: "command", 
			command: command 
		}));
		return {
			content: [
			{ 
				type: "text", 
				text: command
			}]
		}
	});

/**
 * Tool to add or edit series on the chart secondary to the main series.
 * The `symbol` parameter must be a valid stock symbol retrieved with the symbol-search tool.
 * The `options` parameter is optional and can be used to add options to the command.
 * The `options` parameter is a string of letters representing each option:
 * - 'c' will add the series as a comparison to the main series.
 * - 'r' will remove a series with the specified symbol. The series symbol to remove must come from the series-info tool.
 * - 'x' will remove all series except the main series. Ask for confirmation before removing series.
 */
server.tool(
	"series",
	"Chart command: Add or edit series on the chart secondary to the main series. When adding a series, the `symbol` parameter must me a valid stock symbol retrieved with the symbol-search tool. The `options` parameter is optional and can be used to add options to the command. The `options` parameter is a string of letters representing each option. 'c' will add the series as a comparison to the main series. 'r' will remove a series with the specified symbol. The series symbol to remove must come from the series-info tool. 'x' will remove all series except the main series. Ask for confirmation before removing series.",
	{ symbol: z.string(), options: z.string(), sessionId: z.string()  },
	async ({ symbol, options, sessionId }) => {
		const ws = clients.get(sessionId);
		if (options) options = " -" + options;
		let command = `series${options} ${symbol}`;
		//socketConnections[sessionId].send(command);
		ws.send(JSON.stringify({ 
			type: "command", 
			command: command 
		}));
		return {
			content: [
				{ 
					type: "text", 
					text: command
				}]
			}
	}
);

/**
 * Tool to get information about active series on the chart.
 * The `sessionId` parameter is used to identify the websocket connection.
 * 
 * Returns a JSON object with an array of series objects containing:
 * - `id`: The series symbol
 * - `name`: The name of the series
 * - `color`: The color of the series
 * - `symbol`: The symbol of the series
 */
server.tool(
	"series-info",
	"Request to get information about active series on the chart.",
	{ sessionId: z.string() },
	async ({ sessionId }) => {
		let command = `series -r {symbol}`;
		const response = await getSeriesInfo(sessionId);
		return {
			content: [
				{ 
					type: "text", 
					text: JSON.stringify(response)
				}]
		}
	}
);

/**
 * Experimantal websocket backchannel to send commands to the chart.
 * This supports the tools above to send commands to the chart executor without a custom MCP client.
 * The client must register its sessionId with the server by sending a message with type 'registerSession' and sessionId.
 * The server will then store the websocket connection and use it to send commands.
 * 
 * Right now, the client connection is hard coded. See the ReadMe file for details on how to set up the chart.
 */
const transport = new StdioServerTransport();
await server.connect(transport);


// Listen for websocket connections
const wss = new WebSocketServer({ port: 8089 });

// Store all connections by sessionId and pending requests
const clients = new Map(); // sessionId -> ws
const pendingRequests = new Map(); // requestId -> { resolve, timeout, sessionId }

function getSeriesInfo(sessionId) {
	return new Promise((resolve, reject) => {
		const ws = clients.get(sessionId);
		if (!ws) return reject(new Error('No client for sessionId'));
		const requestId = Math.random().toString(36).substr(2, 9);
		const timeout = setTimeout(() => {
			pendingRequests.delete(requestId);
			reject(new Error('Timeout waiting for client response'));
		}, 10000); // 10s timeout
		pendingRequests.set(requestId, { resolve, timeout, sessionId });
		ws.send(JSON.stringify({ type: 'getSeriesInfo', requestId }));
	});
}

wss.on('connection', function connection(ws) {
	let sessionId = null;
	let interval = null;

	ws.on('message', function incoming(message) {
		let data;
		try {
			data = JSON.parse(message);
		} catch (e) {
			return;
		}

		// Handle initial sessionId registration
		if (data.type === 'registerSession' && typeof data.sessionId === 'string') {
			sessionId = data.sessionId;
			clients.set(sessionId, ws);
			// Start random number interval for this client
			//interval = setInterval(() => sendMessage(ws), 5000);
			return;
		}

		// Handle response to getSeriesInfo
		if (data.type === 'seriesInfoResponse' && data.requestId && pendingRequests.has(data.requestId)) {
			const { resolve, timeout, sessionId: reqSessionId } = pendingRequests.get(data.requestId);
			clearTimeout(timeout);
			pendingRequests.delete(data.requestId);
			resolve(data.value);
			return;
		}

	});

	ws.on('close', () => {
		if (sessionId) {
			clients.delete(sessionId);
		}
		if (interval) {
			clearInterval(interval);
		}
	});
});
