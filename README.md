## ChartIQ MCP Server Example

This project uses the @modelcontextprotocol library from Anthropic to run an MCP server. The server provides tool calls to assist interation with ChartIQ: 
- Symbol search from the ChartIQ symbol server. 
- Generate the following ChartIQ CLI commands: `symbol`, `series`. 
- Query the chart for details about series present in the chart.

The last two points above presently work through a websocket back channel, connected directly to the chart. This allows any MCP client to manipulate a chart without  having direct control over it. This is only one possible solution. An alternative solution would be to develop a custom MCP client as part of a complete chart assisted AI application.

## Example queries

"set the chart to toyota"

"now compare this to the top 3 US car manufacturers"

The model can query the color of secondary series. Change one of them to a yellow color and try the following prompt:

"remove the yellow series"

## Instructions

This demo runs both the client and server on the same system using `localhost` as the address.

1. Set up the chart front-end using the instructions below.
2. The server is in the index.js file. Run `npm install` to install the required packages.
3. Configure an MCP client to run the MCP server. I have been using Claude Desktop for my testing. Instructions for setting up can be found here: https://modelcontextprotocol.io/quickstart/user
4. Ensure the mcp server is running in your AI app before attempting the websocket conenction. Then load the chart page.
5. You will see a "Session Id" input and a connect button. Enter any string value as the session Id, it doesn't matter what. I use jsut the letter "a". Then press the connect button. The status indicator should turn green and say "Connected" when it establishes a connection to the MCP server running at `localhost::8089`
6. Go to your AI app. Begin your conversion by informing the model of the session ID with a prompt like this: "when interacting with the chart, your session id is: a"
7. Begin chatting with the model, asking it to do things to the chart.

## Setting Up The Chart
Based off of Sample Template Advanced. A copy of the complete file is in examples/chart-template/ in this project. This was written with version 9.6 so the template may need some updating.

Here is a breakdown of changes made to the template:

Add the UI to establish the websocke connection. Add the following html above the `<cq-context>` element:
```
<div class="ws-controls">
	<input type="text" id="inputText" placeholder="Session ID" />
	<button id="connectBtn">Connect</button>
	<span id="status" class="session-id">Disconnected</span>
</div>
```

Define global variables for the chart executor. This was done in global scope for ease of development. Add the following before the chart is loaded:

```
let aiReady, executor;
```

Get a reference to the chart `executor` to handle CLI commands that will come from the MCP server. Add the following in the chart loaded callback function:

```
aiReady = document.querySelector("cq-cli");
executor = aiReady.getExecutor();
```

Add the code to manage the websocket. Add this anywhere outside of the chart load function:
```
let ws;
const statusDiv = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const input = document.getElementById("inputText");

function getSeriesInfo() {
	let chartSeries = window.stxx.chart.series;
	const series = [];
	for (const [key, value] of Object.entries(chartSeries)) {
		series.push({
			id: value.id,
			name: value.parameters?.name,
			color: value.parameters?.color,
			symbol: value.parameters?.symbol
		});
	}
	return { series };
}

window.getSeriesInfo = getSeriesInfo;

function connect() {
	ws = new WebSocket("ws://" + window.location.hostname + ":8089");
	ws.onopen = () => {
		statusDiv.textContent = "Connected";
		statusDiv.style.color = "green";
		ws.send(
			JSON.stringify({
				type: "registerSession",
				sessionId: input.value || "default-session"
			})
		);
	};
	ws.onclose = () => {
		statusDiv.textContent = "Disconnected.";
		statusDiv.style.color = "red";
	};
	ws.onerror = (err) => {
		statusDiv.textContent = "Error connecting to server.";
		statusDiv.style.color = "red";
	};
	ws.onmessage = (event) => {
		console.log(event.data);
		let data = null;
		try {
			data = JSON.parse(event.data);
		} catch (e) {
			data = {};
		}

		switch (data.type) {
			case "command":
				executor(data.command);
				break;
			case "getSeriesInfo":
				let response = JSON.stringify(getSeriesInfo());
				console.log("Series Info Response: ", response);
				ws.send(
					JSON.stringify({
						type: "seriesInfoResponse",
						requestId: data.requestId,
						value: getSeriesInfo()
					})
				);
				break;
		}
	};
}

connectBtn.onclick = () => {
	if (!ws || ws.readyState === WebSocket.CLOSED) {
		connect();
	}
};
```