import { useState } from "react";
import { AmountConfig } from "@keplr-wallet/hooks";
import { action, computed, makeObservable, observable, override } from "mobx";
import { AppCurrency } from "@keplr-wallet/types";
import { ChainGetter, ObservableQueryBalances } from "@keplr-wallet/stores";
import {
  OptimizedRoutes,
  Pool,
  RoutePathWithAmount,
} from "@osmosis-labs/pools";
import { IFeeConfig } from "@keplr-wallet/hooks/build/tx/types";
import {
  CoinPretty,
  Dec,
  DecUtils,
  Int,
  IntPretty,
  RatePretty,
} from "@keplr-wallet/unit";

export class TradeTokenInConfig extends AmountConfig {
  protected _pools: Pool[];

  @observable
  protected _inCurrencyMinimalDenom: string | undefined = undefined;
  @observable
  protected _outCurrencyMinimalDenom: string | undefined = undefined;

  constructor(
    chainGetter: ChainGetter,
    chainId: string,
    sender: string,
    feeConfig: IFeeConfig,
    queryBalances: ObservableQueryBalances,
    pools: Pool[]
  ) {
    super(chainGetter, chainId, sender, feeConfig, queryBalances);

    this._pools = pools;

    makeObservable(this);
  }

  setPools(pools: Pool[]) {
    this._pools = pools;
  }

  get pools(): Pool[] {
    return this._pools;
  }

  @override
  setSendCurrency(currency: AppCurrency | undefined) {
    if (currency) {
      this._inCurrencyMinimalDenom = currency.coinMinimalDenom;
    } else {
      this._inCurrencyMinimalDenom = undefined;
    }
  }

  @action
  setOutCurrency(currency: AppCurrency | undefined) {
    if (currency) {
      this._outCurrencyMinimalDenom = currency.coinMinimalDenom;
    } else {
      this._outCurrencyMinimalDenom = undefined;
    }
  }

  @override
  get sendCurrency(): AppCurrency {
    if (this.sendableCurrencies.length === 0) {
      return {
        coinMinimalDenom: "unknown",
        coinDenom: "Unknown",
        coinDecimals: 0,
      };
    }

    if (this._inCurrencyMinimalDenom) {
      const currency = this.currencyMap.get(this._inCurrencyMinimalDenom);
      if (currency) {
        return currency;
      }
    }

    return this.sendableCurrencies[0];
  }

  @computed
  get outCurrency(): AppCurrency {
    if (this.sendableCurrencies.length <= 1) {
      return {
        coinMinimalDenom: "unknown",
        coinDenom: "Unknown",
        coinDecimals: 0,
      };
    }

    if (this._outCurrencyMinimalDenom) {
      const currency = this.currencyMap.get(this._outCurrencyMinimalDenom);
      if (currency) {
        return currency;
      }
    }

    return this.sendableCurrencies[1];
  }

  @computed
  protected get currencyMap(): Map<string, AppCurrency> {
    return this.sendableCurrencies.reduce<Map<string, AppCurrency>>(
      (previous, current) => {
        previous.set(current.coinMinimalDenom, current);
        return previous;
      },
      new Map()
    );
  }

  @computed
  get sendableCurrencies(): AppCurrency[] {
    const chainInfo = this.chainInfo;

    // Get all coin denom in the pools.
    const coinDenomSet = new Set<string>();
    for (const pool of this.pools) {
      for (const poolAssetDenom of pool.poolAssetDenoms) {
        coinDenomSet.add(poolAssetDenom);
      }
    }

    const coinDenoms = Array.from(coinDenomSet);

    const currencyMap = chainInfo.currencies.reduce<Map<string, AppCurrency>>(
      (previous, current) => {
        previous.set(current.coinMinimalDenom, current);
        return previous;
      },
      new Map()
    );

    return coinDenoms
      .filter((coinDenom) => {
        return currencyMap.has(coinDenom);
      })
      .map((coinDenom) => {
        return currencyMap.get(coinDenom)!;
      });
  }

  @computed
  get optimizedRoutePaths(): RoutePathWithAmount[] {
    const amount = this.getAmountPrimitive();
    if (
      !amount.amount ||
      new Int(amount.amount).lte(new Int(0)) ||
      amount.denom === "unknown"
    ) {
      return [];
    }

    const routes = new OptimizedRoutes(this.pools);

    return routes.getOptimizedRoutesByTokenIn(
      {
        denom: amount.denom,
        amount: new Int(amount.amount),
      },
      this.outCurrency.coinMinimalDenom,
      5
    );
  }

  @computed
  get expectedSwapResult(): {
    amount: CoinPretty;
    beforeSpotPriceInOverOut: IntPretty;
    beforeSpotPriceOutOverIn: IntPretty;
    afterSpotPriceInOverOut: IntPretty;
    afterSpotPriceOutOverIn: IntPretty;
    effectivePriceInOverOut: IntPretty;
    effectivePriceOutOverIn: IntPretty;
    swapFee: RatePretty;
    slippage: RatePretty;
  } {
    const paths = this.optimizedRoutePaths;
    if (paths.length === 0) {
      return {
        amount: new CoinPretty(this.outCurrency, new Dec(0)),
        beforeSpotPriceInOverOut: new IntPretty(0),
        beforeSpotPriceOutOverIn: new IntPretty(0),
        afterSpotPriceInOverOut: new IntPretty(0),
        afterSpotPriceOutOverIn: new IntPretty(0),
        effectivePriceInOverOut: new IntPretty(0),
        effectivePriceOutOverIn: new IntPretty(0),
        swapFee: new RatePretty(0),
        slippage: new RatePretty(0),
      };
    }

    const multiplicationInOverOut = DecUtils.getTenExponentN(
      this.outCurrency.coinDecimals - this.sendCurrency.coinDecimals
    );

    const result = new OptimizedRoutes(this.pools).calculateTokenOutByTokenIn(
      paths
    );

    return {
      amount: new CoinPretty(this.outCurrency, result.amount),
      beforeSpotPriceInOverOut: new IntPretty(
        result.beforeSpotPriceInOverOut.mulTruncate(multiplicationInOverOut)
      ),
      beforeSpotPriceOutOverIn: new IntPretty(
        result.beforeSpotPriceOutOverIn.quoTruncate(multiplicationInOverOut)
      ),
      afterSpotPriceInOverOut: new IntPretty(
        result.afterSpotPriceInOverOut.mulTruncate(multiplicationInOverOut)
      ),
      afterSpotPriceOutOverIn: new IntPretty(
        result.afterSpotPriceOutOverIn.quoTruncate(multiplicationInOverOut)
      ),
      effectivePriceInOverOut: new IntPretty(
        result.effectivePriceInOverOut.mulTruncate(multiplicationInOverOut)
      ),
      effectivePriceOutOverIn: new IntPretty(
        result.effectivePriceOutOverIn.quoTruncate(multiplicationInOverOut)
      ),
      swapFee: new RatePretty(result.swapFee),
      slippage: new RatePretty(result.slippage),
    };
  }
}

// CONTRACT: Use with `observer`
// If the reference of the pools changes,
// it will be recalculated without memorization for every render.
// Be sure to pass the pools argument by memorizing it.
export const useTradeTokenInConfig = (
  chainGetter: ChainGetter,
  chainId: string,
  sender: string,
  feeConfig: IFeeConfig,
  queryBalances: ObservableQueryBalances,
  pools: Pool[]
) => {
  const [config] = useState(
    () =>
      new TradeTokenInConfig(
        chainGetter,
        chainId,
        sender,
        feeConfig,
        queryBalances,
        pools
      )
  );
  config.setChain(chainId);
  config.setSender(sender);
  config.setFeeConfig(feeConfig);
  config.setQueryBalances(queryBalances);
  config.setPools(pools);

  return config;
};
