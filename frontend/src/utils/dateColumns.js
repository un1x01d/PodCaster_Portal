const DATE_COL_HINTS = [
  "date",
  "uploaded",
  "created",
  "updated",
  "timestamp",
  "quarter",
  "fiscal",
  "period",
  "month",
  "year",
];

export function looksLikeDateColumn(header = "") {
  return DATE_COL_HINTS.some((hint) => String(header).toLowerCase().includes(hint));
}

export { DATE_COL_HINTS };
