// generate_csv.js
import fs from "fs";

const headers = [
  "ID",
  "Deal Type",
  "Teammember Name",
  "Advertiser",
  "Probability",
  "Agency",
  "Product Type",
  "Broadcast Month",
  "Deal Name",
  "Teammember Share",
  "Show Rev Share Percentage",
  "Show Flat Rev Share",
  "Deal Closed Date",
  "Order Id",
  "From MDR Data?",
  "Billing Calendar",
  "Show Content Parent",
  "Show Name Level0",
  "Forecast Budget Distributed",
  "Quantity Delivered Distributed",
  "Net-Net",
  "Region",
];

// Some sample values to randomize
const dealTypes = ["digital - direct", "sponsorship"];
const teammembers = ["Amelia Bailey", "Angela Codella", "John Smith", "Jane Doe", "Robert Brown", "Emily White", "Chris Johnson", "Sarah Lee"];
const advertisers = ["Cozy Earth", "MeUndies", "Apple", "Microsoft", "Netflix", "Amazon", "Google", "Spotify"];
const agencies = ["Cozy Earth - direct", "Maybe Both LLC", "Veritone", "Omnicom", "WPP", "IPG", "Dentsu", "Publicis"];
const productTypes = ["Podcast O&O", "Podcast Partner"];
const months = ["2024-11","2024-12","2025-01","2025-02","2025-03","2025-04"];
const parents = ["Jordan Berman", "Maybe Both LLC", "Lisa Damour", "Your Zen Mama"];
const shows = ["Unbiased", "Brutally Anna", "Ask Lisa", "The Mother Daze"];
const billing = ["Monthly", "Quarterly"];
const regions = ["US-East", "US-West", "US-Central", "EU-West", "EU-North", "APAC"];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomMoney(min, max) {
  return `$${(Math.random() * (max - min) + min).toFixed(2)}`;
}

let rows = [headers.join(",")];

for (let i = 1; i <= 1000; i++) {
  const dealType = randomChoice(dealTypes);
  const team = randomChoice(teammembers);
  const adv = randomChoice(advertisers);
  const prob = `${Math.floor(Math.random() * 51) + 50}%`; // 50–100%
  const agency = randomChoice(agencies);
  const productType = randomChoice(productTypes);
  const month = randomChoice(months);
  const dealName = `${adv} Campaign ${i}`;
  const share = Math.floor(Math.random() * 101);
  const revSharePct = Math.floor(Math.random() * 71) + 30;
  const flatRevShare = Math.random() > 0.7 ? randomMoney(100, 5000) : "";
  const closedDate = `2024-${String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`;
  const orderId = 1600000 + i;
  const mdr = Math.random() > 0.5 ? "true" : "false";
  const bill = randomChoice(billing);
  const parent = randomChoice(parents);
  const show = randomChoice(shows);
  const forecast = randomMoney(1000, 50000);
  const delivered = Math.floor(Math.random() * 500);
  const netnet = randomMoney(500, 40000);
  const region = randomChoice(regions);

  const row = [
    i,
    dealType,
    team,
    adv,
    prob,
    agency,
    productType,
    month,
    dealName,
    share,
    revSharePct,
    flatRevShare,
    closedDate,
    orderId,
    mdr,
    bill,
    parent,
    show,
    forecast,
    delivered,
    netnet,
    region,
  ].join(",");

  rows.push(row);
}

fs.writeFileSync("sample_data.csv", rows.join("\n"));
console.log("✅ sample_data.csv with 1000 rows generated!");

