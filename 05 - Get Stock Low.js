function getStockLow(ticker) {
  const tempSheet = SpreadsheetApp.create("TempLow");
  const cell = tempSheet.getSheets()[0].getRange("A1");
  cell.setFormula(`=GOOGLEFINANCE("${ticker}", "low52")`);
  SpreadsheetApp.flush();
  const val = cell.getValue();
  DriveApp.getFileById(tempSheet.getId()).setTrashed(true);
  return val;
}