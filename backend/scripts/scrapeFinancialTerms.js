// Draft script to scrape financial terms and ingest them
import { query } from "../src/config/db.js";
import axios from "axios";
import * as cheerio from "cheerio"; // assuming cheerio is in node_modules or we need to add it

const SOURCES = [
  // Wikipedia List of accounting topics
  "https://en.wikipedia.org/wiki/List_of_accounting_topics"
];

async function run() {
  console.log("Starting scrape...");
  // ... implementation ...
}
run();
