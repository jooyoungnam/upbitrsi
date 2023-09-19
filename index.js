const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = 3000;
app.use(express.static('public'));
let isUpdating = false;
let lastInterval = 240; // 마지막으로 요청받은 interval 값을 저장하기 위한 변수

let cachedRSI = {};
let krwMarkets = [];
let lastUpdated = null;

app.use(cors());

app.get('/', (req, res) => {
  res.send('Upbit RSI API server.');
});

async function loadMarkets() {
  const response = await axios.get('https://api.upbit.com/v1/market/all');
  krwMarkets = response.data
    .filter(market => market.market.startsWith('KRW'))
    .map(market => ({ market: market.market, korean_name: market.korean_name }));
}

async function getRSI(market, interval = 240) {
  let url;
  if (interval === 'day') {
    url = `https://api.upbit.com/v1/candles/days?market=${market}&count=200`;
  } else if (interval === 'week') {
    url = `https://api.upbit.com/v1/candles/weeks?market=${market}&count=200`;
  } else if (interval === 'month') {
    url = `https://api.upbit.com/v1/candles/months?market=${market}&count=200`;
  } else {
    url = `https://api.upbit.com/v1/candles/minutes/${interval}?market=${market}&count=200`;
  }
  
  // 단일 response를 사용하여 데이터를 가져옵니다.
  const response = await axios.get(url);
  const data = response.data.reverse();
  
  const upList = [];
  const downList = [];
  const zero = 0;

  // 캔들간 가격 차이 계산
  for (let i = 0; i < data.length - 1; i++) {
    const gapByTradePrice = data[i + 1].trade_price - data[i].trade_price;
    
    if (gapByTradePrice > 0) {
      upList.push(gapByTradePrice);
      downList.push(zero);
    } else if (gapByTradePrice < 0) {
      downList.push(-gapByTradePrice);
      upList.push(zero);
    } else {
      upList.push(zero);
      downList.push(zero);
    }
  }
  
  const day = 14;
  const a = 1 / (1 + (day - 1));
  
  // 지수 이동 평균 계산
  let upEma = upList[0];
  for (let i = 1; i < upList.length; i++) {
    upEma = (upList[i] * a) + (upEma * (1 - a));
  }

  let downEma = downList[0];
  for (let i = 1; i < downList.length; i++) {
    downEma = (downList[i] * a) + (downEma * (1 - a));
  }

  // RSI 계산
  const rs = upEma / downEma;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

// RSI 업데이트 함수
async function updateRSI() {
  if (isUpdating) return;
  isUpdating = true;

  for (const market of krwMarkets) {
    try {
      const rsi = await getRSI(market.market, lastInterval); // lastInterval 사용
      if (rsi !== null) {
        cachedRSI[market.market] = { rsi, korean_name: market.korean_name };
      }
    } catch (error) {
      console.error(`Failed to update RSI for ${market.market}`, error);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  isUpdating = false;
  lastUpdated = new Date().toISOString();
  
  // RSI 값에 따라 내림차순 정렬
  cachedRSI = Object.fromEntries(
    Object.entries(cachedRSI).sort(([,a], [,b]) => b.rsi - a.rsi)
  );
}

app.get('/rsi', async (req, res) => {
  const interval = req.query.interval || 240;
  lastInterval = interval; // 마지막으로 요청받은 interval 값을 저장
  if (!isUpdating) {
    await updateRSI();
  }
  res.json({ rsiData: cachedRSI, lastUpdated });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  loadMarkets().then(() => {
    updateRSI();
    setInterval(() => updateRSI(), 60 * 1000);
  });
});
