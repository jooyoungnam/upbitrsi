const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT;

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


const { spawn } = require('child_process');

function callPythonScript(data) {
  return new Promise((resolve, reject) => {
     const pythonProcess = spawn('python', ['./scikit_learn.py', ...data]);

      pythonProcess.stdout.on('data', (data) => {
          resolve(parseFloat(data));
      });

      pythonProcess.stderr.on('data', (data) => {
          reject(data.toString());
      });
  });
}


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
  const url = `https://api.upbit.com/v1/candles/days?market=${market}&count=90`;
  const response = await axios.get(url);
  console.log(response.data.length);  // 응답 데이터의 길이 출력
  console.log(response.data);  // 응답 데이터의 내용 출력
  const data = response.data.reverse();  // 데이터를 뒤집어서 최근 날짜부터 정렬
  return data.map(day => day.prev_closing_price);
}

getSixtyDayPrices('KRW-BTC').then(prices => {
  console.log(prices);
}).catch(error => {
  console.error(error);
});


async function getScikitPredictedPrice(sixtyDayPrices, currentPrice) {
  try {
    const predictedPrice = await callPythonScript([...sixtyDayPrices, currentPrice]);
    return predictedPrice;
  } catch (error) {
    console.error('Error getting scikit predicted price:', error);
    throw error;  // 오류를 던져서 상위 코드에서 처리할 수 있게 합니다.
  }
}

async function getThirtyDayPrices(market) {
  const url = `https://api.upbit.com/v1/candles/days?market=${market}&count=90`;  // 수정된 부분
  const response = await axios.get(url);
  const data = response.data;
  const thirtyDayPrices = data.map(day => day.prev_closing_price);
  console.log(thirtyDayPrices);
  return thirtyDayPrices;
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
          const scikitPredictedPrice = await getScikitPredictedPrice(sixtyDayPrices, currentPrice);
          console.log('Scikit-learn Predicted Price:', scikitPredictedPrice);

          cachedData[market.market] = {
              rsi,
              korean_name: market.korean_name,
              currentPrice,
              sevenDayPrices,
              scikitPredictedPrice  
          };

      } catch (error) {
        console.error(`Failed to update data for ${market.market}: ${error.message}`, error);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
  }

  isUpdating = false;
  lastUpdated = new Date().toISOString();

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
