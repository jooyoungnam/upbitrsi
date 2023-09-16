const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

let cachedRSI = {};
let marketIndex = 0;
let krwMarkets = [];

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/rsi', (req, res) => {
  res.json({ rsiData: cachedRSI });
});

async function loadMarkets() {
  try {
    const marketResponse = await axios.get('https://api.upbit.com/v1/market/all');
    krwMarkets = marketResponse.data
      .filter(m => m.market.startsWith('KRW'))
      .map(m => ({ market: m.market, korean_name: m.korean_name }));
  } catch (error) {
    console.error("마켓 정보 로딩 중 에러:", error);
  }
}

async function updateOneMarketRSI() {
  if (krwMarkets.length === 0) {
    console.error("마켓 정보가 비어 있습니다.");
    return;
  }

  try {
    const market = krwMarkets[marketIndex];
    const rsi = await getRSI(market.market);
    cachedRSI[market.market] = { rsi, korean_name: market.korean_name };

    marketIndex = (marketIndex + 1) % krwMarkets.length;
  } catch (error) {
    console.error("RSI 업데이트 중 에러:", error);
  }
}

async function getRSI(market, interval = 240) {
  const count = 200;
  const url = `https://api.upbit.com/v1/candles/minutes/${interval}?market=${market}&count=${count}`;
  const response = await axios.get(url);
  const data = response.data.reverse();
 
  let upList = [];
  let downList = [];

  const n = 14;
  const a = 1 / (1 + (n - 1));

  for (let i = 0; i < data.length - 1; i++) {
    const gap = data[i + 1].trade_price - data[i].trade_price;

    if (gap > 0) {
      upList.push(gap);
      downList.push(0);
    } else if (gap < 0) {
      upList.push(0);
      downList.push(-gap);
    } else {
      upList.push(0);
      downList.push(0);
    }
  }

  let upEma = upList[0];
  for (let i = 1; i < upList.length; i++) {
    upEma = (upList[i] * a) + (upEma * (1 - a));
  }

  let downEma = downList[0];
  for (let i = 1; i < downList.length; i++) {
    downEma = (downList[i] * a) + (downEma * (1 - a));
  }

  const rs = upEma / downEma;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

setInterval(() => {
  updateOneMarketRSI();
}, 1 * 60 * 1000);

loadMarkets().then(() => {
  updateOneMarketRSI();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

setInterval(() => {
  console.log("Resetting RSI data...");
  cachedRSI = {};
}, 1000 * 60 * 60 * 24 * 7);

loadMarkets().then(() => {
  updateOneMarketRSI();
});