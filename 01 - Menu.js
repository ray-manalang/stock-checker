function onOpen() {
  const ui = SpreadsheetApp.getUi();
  
  ui.createMenu('📈 Stock Bot')
      .addItem('Analyze Selected Stock(s)', 'runStockAnalysis')
      // .addSeparator()
      // .addItem('Update Market Data', 'refreshSheetData') // Optional: force a refresh
      .addToUi();
}