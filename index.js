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


//https://symbols.chartiq.com/chiq.symbolserver.SymbolLookup.service?t=ibm&m=100&x=[XNYS,XASE,XNAS,XASX,IND_CBOM,INDXASE,INDXNAS,IND_DJI,ARCX,INDARCX,forex,mutualfund,futures]
// const symbolServerUrl = "https://symbols.chartiq.com/chiq.symbolserver.SymbolLookup.service?"
const symbolServerUrl = "http://localhost:9130/symbol_lookup_service/?";
const exchangeFilters = "[\"XNYS\",\"XASE\",\"XNAS\",\"XASX\",\"IND_CBOM\",\"INDXASE\",\"INDXNAS\",\"IND_DJI\",\"ARCX\",\"INDARCX\",\"forex\",\"mutualfund\",\"futures\"]";


// server.tool(
//   "symbol-search-http",
//   "Search for a valid stock symbol",
//   { query: z.string() },
//   async ({ query }) => {
// 	let fetchUrl = `t=${query}&m=100&x=${exchangeFilters}`;
// 	let response = processRequest(fetchUrl);
// 	// let response = await fetch(fetchUrl);
// 	// let data = await response.json();
// 	// let result = [];
// 	// if (data && data.payload) {
// 	// 	// Example symbol: IBM|International Business Machines Corp.|NYSE|XNYS
// 	// 	let {symbols} = data.payload;
// 	// 	result = symbols.map((symbol) => {
// 	// 		let parts = symbol.split("|");
// 	// 		return {
// 	// 			symbol: parts[0],
// 	// 			name: parts[1],
// 	// 			exchange: parts[2]
// 	// 		};
// 	// 	});
// 	// }
// 	// return {
// 	// 	content: [{
// 	// 		type: "text",
// 	// 		text: JSON.stringify(result)
// 	// 	}]
// 	// };
//   }
// );



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




// server.resource(
// 	"symbol-search",
// 	new ResourceTemplate("symbol-search://{query}", { list: undefined }),
// 	async (uri, { query }) => {
// 	  let fetchUrl = `${symbolServerUrl}t=${query}&m=100&x=${exchangeFilters}`;
// 	//   let response = await fetch(fetchUrl);
// 	//   let data = await response.json();
// 	//   let result = [];
// 	//   if (data && data.payload) {
// 	// 	  // Example symbol: IBM|International Business Machines Corp.|NYSE|XNYS
// 	// 	  let {symbols} = data.payload;
// 	// 	  result = symbols.map((symbol) => {
// 	// 		  let parts = symbol.split("|");
// 	// 		  return {
// 	// 			  symbol: parts[0],
// 	// 			  name: parts[1],
// 	// 			  exchange: parts[2]
// 	// 		  };
// 	// 	  });
// 	//   }
// 	  return {
// 		  contents: [{
// 			uri: uri.href,
// 			text: JSON.stringify(hardResult),
// 		  }]
// 	  };
// 	}
// );



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

server.tool(
	"series-info",
	"Request to get information about active series on the chart.",
	{ sessionId: z.string() },
	async ({ sessionId }) => {
		let command = `series -r {symbol}`;
		// socketConnections[sessionId].send(JSON.stringify({ 
		// 	type: "series-info", 
		// 	command: command 
		// }));
		// let response = `{"series":[{"id":"GOOG","name":"comparison GOOG","color":"rgb(142, 198, 72)","symbol":"GOOG"},{"id":"IBM","name":"comparison IBM","color":"rgb(0, 175, 237)","symbol":"IBM"},{"id":"F","name":"comparison F","color":"rgb(238, 101, 46)","symbol":"F"}]}`;
		// let jsonData = JSON.parse(response);
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

// wss.on('connection', function connection(ws, req, client) {
//   ws.on('message', function incoming(message) {
//     // const reversed = message.toString().split('').reverse().join('');
//     // ws.send(JSON.stringify({ type: 'reverse', value: reversed }));
// 	try {
// 		let data = JSON.parse(message.toString());
// 		if (data && data.sessionId) {
// 			socketConnections[data.sessionId] = ws;
// 		}

// 		 ws.on('close', () => {
// 			socketConnections[data.sessionId] = null;
// 		});

// 		//console.log("Added socket connection for sessionId:", data.sessionId, Object.keys(socketConnections).length, "total connections");
// 	} catch (e) {}
// 	// console.log('received: %s', message);
//   });
// });
