const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = 3000;

// 정적 파일을 제공할 디렉토리 설정
app.use(express.static('public'));

// 캐싱된 RSI와 마지막 업데이트 시간을 저장할 변수
let cachedRSI = {};
let krwMarkets = [];
let lastUpdated = null;

// CORS 미들웨어 사용 설정
app.use(cors());

// 기본 라우트 설정
app.get('/', (req, res) => {
  res.send('Upbit RSI API server.');
});

// 업비트에서 모든 시장 데이터를 가져와 KRW로 시작하는 시장만 필터링
async function loadMarkets() {
  const response = await axios.get('https://api.upbit.com/v1/market/all');
  krwMarkets = response.data
    .filter(market => market.market.startsWith('KRW'))
    .map(market => ({ market: market.market, korean_name: market.korean_name }));
}

// RSI 계산 함수
async function getRSI(market, interval = 240) {
  // 200개의 캔들 데이터를 가져옴
  const count = 200;
  const url = `https://api.upbit.com/v1/candles/minutes/${interval}?market=${market}&count=${count}`;
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
  for (const market of krwMarkets) {
    try {
      const rsi = await getRSI(market.market);
      if (rsi !== null) {
        cachedRSI[market.market] = { rsi, korean_name: market.korean_name };
      }
    } catch (error) {
      console.error(`Failed to update RSI for ${market.market}`, error);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // 마지막 업데이트 시간 저장
  lastUpdated = new Date().toISOString();
  
  // RSI 값에 따라 내림차순 정렬
  cachedRSI = Object.fromEntries(
    Object.entries(cachedRSI).sort(([,a], [,b]) => b.rsi - a.rsi)
  );
}

// RSI 데이터 반환 라우트
app.get('/rsi', (req, res) => {
  res.json({ rsiData: cachedRSI, lastUpdated });
});

// 서버 시작
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  loadMarkets().then(() => {
    updateRSI();
    setInterval(updateRSI, 60 * 1000); // 1분마다 RSI 업데이트
  });
});
