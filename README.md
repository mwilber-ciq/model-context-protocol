## ChartIQ MCP Server Example

This project uses the @modelcontextprotocol library from Anthropic to run an MCP server. The server provides tool calls to assist interation with ChartIQ: 
- Symbol search from the ChartIQ symbol server. 
- Generate the following ChartIQ CLI commands: `symbol`, `series`. 
- Query the chart for details about series present in the chart.

The last two points above presently work through a websocket back channel, connected directly to the chart. This allows any MCP client to manipulate a chart without  having direct control over it. This is only one possible solution. An alternative solution would be to develop a custom MCP client as part of a complete chart assisted AI application.

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