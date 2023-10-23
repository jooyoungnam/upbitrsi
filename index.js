const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(express.static('public'));

let isUpdating = false;
let lastInterval = 240;  // 마지막으로 요청받은 interval 값을 저장하기 위한 변수
let cachedData = {};  // RSI와 현재가 정보를 저장하는 객체
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

async function getCurrentPrice(market) {
  const url = `https://api.upbit.com/v1/ticker?markets=${market}`;
  const response = await axios.get(url);
  return response.data[0].trade_price;
}

async function getSevenDayPrices(market) {
  const url = `https://api.upbit.com/v1/candles/days?market=${market}&count=7`;
  const response = await axios.get(url);
  const data = response.data;
  return data.map(day => day.prev_closing_price);
}

async function getSixtyDayPrices(market) {
  const url = `https://api.upbit.com/v1/candles/days?market=${market}&count=60`;
  const response = await axios.get(url);
  console.log(response.data.length);  // 응답 데이터의 길이 출력
  console.log(response.data);  // 응답 데이터의 내용 출력
  const data = response.data.reverse();  // 데이터를 뒤집어서 최근 날짜부터 정렬
  return data.map(day => day.prev_closing_price);
}

getSixtyDayPrices('KRW-BTC');



async function getThirtyDayPrices(market) {
  const url = `https://api.upbit.com/v1/candles/days?market=${market}&count=60`;  // 수정된 부분
  const response = await axios.get(url);
  const data = response.data;
  const thirtyDayPrices = data.map(day => day.prev_closing_price);
  console.log(thirtyDayPrices);
  return thirtyDayPrices;
}

function predictPrice(prices) {
  const days = prices.length;
  const sumX = (days * (days + 1)) / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((sum, price, index) => sum + price * (index + 1), 0);
  const sumXX = Array.from({ length: days }, (_, index) => (index + 1) ** 2).reduce((a, b) => a + b, 0);

  const slope = (days * sumXY - sumX * sumY) / (days * sumXX - sumX ** 2);
  const intercept = (sumY - slope * sumX) / days;

  let predictedPrice = slope * (days + 1) + intercept;  // 내일의 가격 예측
  predictedPrice = Math.round(predictedPrice);  // 예측된 가격을 반올림
  console.log({ slope, intercept, predictedPrice });
  return predictedPrice;
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

const ARIMA = require('arima');

async function getArimaPredictedPrice(prices) {
  console.log('Prices:', prices);  // Prices 로깅
  
  // arima 초기화 및 훈련 시작
  const arima = new ARIMA({
      p: 5,  // ARIMA(p,d,q)의 p 값
      d: 2,  // ARIMA(p,d,q)의 d 값
      q: 1,  // ARIMA(p,d,q)의 q 값
      verbose: false  // 로깅 레벨 설정
  }).train(prices);  // prices는 시계열 데이터입니다.

  // 다음 1개 값 예측
  const [pred, errors] = arima.predict(1);  // 여기서는 1단계 미래 값을 예측합니다.
  const predictedPrice = Math.round(pred[0]);  // 예측된 가격을 반올림합니다.
  const formattedPrice = predictedPrice.toLocaleString('ko-KR');  // 한국 돈 표시처럼 ,를 넣습니다.
  console.log('ARIMA Predicted Price:', formattedPrice + ' KRW');  // ARIMA Predicted Price 로깅
  return formattedPrice + ' KRW';  // 반올림된 가격과 'KRW' 단위를 함께 반환합니다.
}



async function updateData() {
  if (isUpdating) return;
  isUpdating = true;

  for (const market of krwMarkets) {
      try {
          const rsi = await getRSI(market.market, lastInterval);
          const currentPrice = await getCurrentPrice(market.market);
          const sevenDayPrices = await getSevenDayPrices(market.market);
          const thirtyDayPrices = await getThirtyDayPrices(market.market);
          const sixtyDayPrices = await getSixtyDayPrices(market.market);
          const predictedPrice = predictPrice(sixtyDayPrices);  // 수정된 부분
          const arimaPredictedPrice = await getArimaPredictedPrice(sixtyDayPrices);  // 수정된 부분
          console.log('ARIMA Predicted Price:', arimaPredictedPrice);  // ARIMA Predicted Price 로깅

          cachedData[market.market] = {
              rsi,
              korean_name: market.korean_name,
              currentPrice,
              sevenDayPrices,
              predictedPrice,
              arimaPredictedPrice  // Add the ARIMA predicted price
          };

      } catch (error) {
          console.error(`Failed to update data for ${market.market}`, error);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
  }

  isUpdating = false;
  lastUpdated = new Date().toISOString();

  cachedData = Object.fromEntries(
      Object.entries(cachedData).sort(([,a], [,b]) => b.rsi - a.rsi)
  );

  // RSI 값에 따라 내림차순 정렬
  cachedData = Object.fromEntries(
    Object.entries(cachedData).sort(([,a], [,b]) => b.rsi - a.rsi)
  );
}

app.get('/rsi', async (req, res) => {
  const interval = req.query.interval || 240;
  lastInterval = interval;  // 마지막으로 요청받은 interval 값을 저장
  if (!isUpdating) {
    await updateData();
  }
  res.json({ rsiData: cachedData, lastUpdated });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  loadMarkets().then(() => {
    updateData();
    setInterval(() => updateData(), 60 * 1000);  // 1분마다 데이터 업데이트
  });
});
