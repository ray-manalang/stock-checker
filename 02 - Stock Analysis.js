function runStockAnalysis() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const stocksSheet = spreadsheet.getSheetByName("Stocks");

  // Gets all data and slices the header
  const stocksData = stocksSheet.getDataRange().getValues();
  const dataRows = stocksData.slice(1);

  for (var i = 0; i < dataRows.length; i++) {
    const rowItem = dataRows[i];
    const analyze = rowItem[0];
    const ticker = rowItem[1];

    const currentRow = i + 2;

    if (analyze === true) {
      try {
        const price = getStockPrice(ticker);
        const high52 = getStockHigh(ticker);
        const low52 = getStockLow(ticker);

        const stockPrices = `Current Price: $${price} \n\n52-Week High: $${high52} \n\n52-Week Low: $${low52}`;

        const prompt = `
        ### INSTRUCTION ###
        You are an expert senior equity research analyst. Your task is to analyze price data for a specific ticker and provide a structured outlook. 

        ### CONSTRAINTS ###
        - You must ONLY output the following four fields.
        - Do not include any introductory or concluding text.
        - The "Reasoning" must be exactly one sentence.
        
        ### DATA ###
        Ticker: ${ticker}
        Current Price: $${price}
        52-Week High: $${high52}
        52-Week Low: $${low52}
        
        ### REFERENCE EXAMPLE ###
        Trend: Neutral/Bullish
        Target Buy Zone: $145.00 - $150.00
        Signal: HOLD
        Reasoning: Price is currently consolidating near the 52-week high, suggesting a breakout attempt if volume increases.
        
        ### OUTPUT ###`;

        const analysis = asUtility.SubmitRequestToGCPAPI(prompt);

        stocksSheet.getRange(currentRow, 1).setValue(false);
        stocksSheet.getRange(currentRow, 3).setValue(stockPrices);
        stocksSheet.getRange(currentRow, 4).setValue(analysis);

        console.log(`Processed ${ticker} at row ${currentRow}`);

      } catch (e) {
        console.log(`Error processing ${ticker}: ` + e.toString());
        stocksSheet.getRange(currentRow, 2).setValue("Error fetching analysis.");
      }
    }
  }
}