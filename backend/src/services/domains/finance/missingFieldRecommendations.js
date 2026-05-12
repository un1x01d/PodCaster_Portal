export function financeMissingFieldRecommendations(missing = []) {
  return missing.map((m) => ({
    cash: "Cash / Cash Balance",
    cash_in: "Cash In / Cash Inflow",
    cash_out: "Cash Out / Cash Outflow",
    current_assets: "Current Assets",
    current_liabilities: "Current Liabilities",
    debt: "Debt / Loans",
    equity: "Equity",
  }[m] || m));
}
