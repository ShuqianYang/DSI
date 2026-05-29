const WebSocket = require('ws');
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

ws.on('open', () => {
  const sub = {
    Apikey: '60c81f80800c63233b611d93088dfb558acc6f9d', // 无 key 则留空
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [],
    FilterMessageTypes: ['PositionReport']
  };
  ws.send(JSON.stringify(sub));
  console.log('已订阅东海船舶数据...');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.Message && msg.Message.PositionReport) {
    const p = msg.Message.PositionReport;
    console.log(`船名: ${msg.MetaData.ShipName}, MMSI: ${msg.MetaData.MMSI}, 坐标: [${p.Latitude}, ${p.Longitude}], 航速: ${p.Sog}节`);
  }
});

ws.on('error', console.error);
// 10 秒后自动断开，防止刷屏
setTimeout(() => ws.close(), 10000);