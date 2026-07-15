import WebSocket from "ws";

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

ws.on("open", () => {
  console.log("[Debug] WS open");
  const sub = {
    Apikey: "60c81f80800c63233b611d93088dfb558acc6f9d",
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [],
    FilterMessageTypes: ["PositionReport"],
  };
  ws.send(JSON.stringify(sub));
  console.log("[Debug] Subscribed");
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.Message?.PositionReport) {
    const p = msg.Message.PositionReport;
    console.log(`[Debug] ${msg.MetaData.MMSI} [${p.Latitude.toFixed(2)}, ${p.Longitude.toFixed(2)}]`);
  } else {
    console.log("[Debug] other msg:", Object.keys(msg));
  }
});

ws.on("error", (err) => console.error("[Debug] Error:", err.message));
ws.on("close", (code, reason) => console.log(`[Debug] Close code=${code} reason=${reason}`));

setTimeout(() => {
  console.log("[Debug] Closing...");
  ws.close();
}, 10000);
