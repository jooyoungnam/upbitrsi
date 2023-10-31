import sys
import numpy as np
from sklearn.svm import SVR
from sklearn.preprocessing import MinMaxScaler

def main():
    prices = [float(price) for price in sys.argv[1:]]
    prices = np.array(prices).reshape(-1, 1)  # 모양 변경

    scaler = MinMaxScaler()
    data_scaled = scaler.fit_transform(prices)

    X = np.arange(len(data_scaled)).reshape(-1, 1)
    y = data_scaled.flatten()

    model = SVR()
    model.fit(X, y)

    tomorrow = np.array([[len(data_scaled)]])
    predicted_price_scaled = model.predict(tomorrow)
    predicted_price = scaler.inverse_transform(predicted_price_scaled.reshape(-1, 1))[0][0]

    print(predicted_price)

if __name__ == "__main__":
    main()