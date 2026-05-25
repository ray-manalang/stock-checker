function getStockHigh(ticker) {
  const tempSheet = SpreadsheetApp.create("TempCalcHigh");
  const cell = tempSheet.getSheets()[0].getRange("A1");
  cell.setFormula(`=GOOGLEFINANCE("${ticker}", "high52")`);
  SpreadsheetApp.flush();
  const val = cell.getValue();
  DriveApp.getFileById(tempSheet.getId()).setTrashed(true);
  return val;
}