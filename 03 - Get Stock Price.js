function getStockPrice(ticker) {
  const tempSheet = SpreadsheetApp.create("TempCalc");
  const cell = tempSheet.getSheets()[0].getRange("A1");
  cell.setFormula(`=GOOGLEFINANCE("${ticker}", "price")`);
  SpreadsheetApp.flush();
  const val = cell.getValue();
  DriveApp.getFileById(tempSheet.getId()).setTrashed(true); // Cleanup
  return val;
}