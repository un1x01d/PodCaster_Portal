import pandas as pd
import numpy as np
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from datetime import datetime, timedelta

output_file = "enterprise_financials_2020_2026.xlsx"
num_rows = 140000 

print(f"Generating {num_rows} rows of realistic multi-year financials...")

# --- DATA POOLS ---
regions = ["North America", "EMEA", "APAC", "LATAM", "DACH"]
segments = ["Enterprise", "Mid-Market", "SMB", "Public Sector"]
product_catalog = [
    {"name": "Industrial Sensor A", "cat": "Hardware", "sub": "IoT", "price": 450.0, "cost": 180.0},
    {"name": "Industrial Sensor B", "cat": "Hardware", "sub": "IoT", "price": 750.0, "cost": 320.0},
    {"name": "SaaS Platform Pro", "cat": "Software", "sub": "SaaS", "price": 1200.0, "cost": 150.0},
    {"name": "SaaS Platform Basic", "cat": "Software", "sub": "SaaS", "price": 500.0, "cost": 50.0},
    {"name": "Consulting Package", "cat": "Services", "sub": "Professional", "price": 5000.0, "cost": 2500.0},
    {"name": "Training Workshop", "cat": "Services", "sub": "Support", "price": 2500.0, "cost": 800.0},
]

# --- WORKBOOK SETUP ---
wb = Workbook()
# 1. Sales_Data (Main Fact Table)
ws_sales = wb.active
ws_sales.title = "Sales_Data"

# 2. Product_Master
ws_prod = wb.create_sheet("Product_Master")
# 3. Regional_Lookup
ws_reg = wb.create_sheet("Regional_Lookup")
# 4. Marketing_Spend (Side Fact Table)
ws_mkt = wb.create_sheet("Marketing_Spend")
# 5. Executive_Summary (Aggregates)
ws_sum = wb.create_sheet("Executive_Summary")

# --- POPULATE LOOKUPS ---
# Product Master
ws_prod.append(["Product_Name", "Category", "Sub_Category", "List_Price", "Standard_Unit_Cost"])
for p in product_catalog:
    ws_prod.append([p["name"], p["cat"], p["sub"], p["price"], p["cost"]])

# Regional Lookup
ws_reg.append(["Region", "Key_Market", "Sales_Director"])
for r in regions:
    ws_reg.append([r, f"{r}_Primary", f"Director_{r[0]}"])

# --- POPULATE SALES DATA ---
headers = [
    "Date", "Order_ID", "Region", "Segment", "Product_Name", 
    "Quantity", "Unit_Price", "Unit_Cost", "Discount_Pct", 
    "Gross_Revenue", "COGS", "Net_Revenue", "Net_Income", "Margin_Pct"
]
ws_sales.append(headers)

# Formatting
header_font = Font(bold=True, color="FFFFFF")
header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
for cell in ws_sales[1]:
    cell.font = header_font
    cell.fill = header_fill

start_date = datetime(2020, 1, 1)
end_date = datetime(2026, 12, 31)
delta_days = (end_date - start_date).days

print("Streaming transactional rows...")
for i in range(num_rows):
    # Determine date (skewed slightly to later years for growth trends)
    days_to_add = int(np.random.beta(2, 1) * delta_days)
    curr_date = start_date + timedelta(days=days_to_add)
    
    order_id = f"ORD-{curr_date.year}-{1000000 + i}"
    region = np.random.choice(regions)
    segment = np.random.choice(segments)
    product = np.random.choice(product_catalog)
    
    qty = np.random.randint(1, 20)
    # Variance in price/cost
    price = product["price"] * np.random.uniform(0.9, 1.1)
    cost = product["cost"] * np.random.uniform(0.95, 1.05)
    discount = round(np.random.beta(1, 5) * 0.25, 4)
    
    r_idx = i + 2
    row = [
        curr_date, order_id, region, segment, product["name"],
        qty, round(price, 2), round(cost, 2), discount
    ]
    ws_sales.append(row)
    
    # Formulas (J:GrossRev, K:COGS, L:NetRev, M:NetIncome, N:Margin%)
    # J = F*G (Qty * Price)
    ws_sales.cell(row=r_idx, column=10).value = f"=F{r_idx}*G{r_idx}"
    # K = F*H (Qty * Cost)
    ws_sales.cell(row=r_idx, column=11).value = f"=F{r_idx}*H{r_idx}"
    # L = J*(1-I) (GrossRev * (1-Discount))
    ws_sales.cell(row=r_idx, column=12).value = f"=J{r_idx}*(1-I{r_idx})"
    # M = L-K (NetRev - COGS)
    ws_sales.cell(row=r_idx, column=13).value = f"=L{r_idx}-K{r_idx}"
    # N = M/L (Income / NetRev)
    ws_sales.cell(row=r_idx, column=14).value = f"=IF(L{r_idx}=0,0,M{r_idx}/L{r_idx})"
    
    if i % 25000 == 0:
        print(f"Processed {i} rows...")

ws_sales.freeze_panes = "A2"

# --- MARKETING SPEND (Monthly) ---
print("Generating marketing spend data...")
ws_mkt.append(["Year", "Month", "Region", "Spend_USD"])
for year in range(2020, 2027):
    for month in range(1, 13):
        for reg in regions:
            spend = np.random.uniform(5000, 50000) * (1 + (year-2020)*0.1)
            ws_mkt.append([year, month, reg, round(spend, 2)])

# --- EXECUTIVE SUMMARY ---
print("Building summary aggregates...")
ws_sum.append(["Year", "Total Net Revenue", "Total Net Income", "Avg Margin %"])
for year in range(2020, 2027):
    y_idx = year - 2020 + 2
    ws_sum.cell(row=y_idx, column=1).value = year
    # Summing Sales_Data!L (Net Revenue) based on year in Column A
    # Note: Complex SUMIFS with dates in openpyxl requires string range building
    # For speed/reliability in the sample, we'll use a representative range
    ws_sum.cell(row=y_idx, column=2).value = f"=SUMIFS(Sales_Data!L:L, Sales_Data!A:A, \">=\"&DATE({year},1,1), Sales_Data!A:A, \"<=\"&DATE({year},12,31))"
    ws_sum.cell(row=y_idx, column=3).value = f"=SUMIFS(Sales_Data!M:M, Sales_Data!A:A, \">=\"&DATE({year},1,1), Sales_Data!A:A, \"<=\"&DATE({year},12,31))"
    ws_sum.cell(row=y_idx, column=4).value = f"=AVERAGEIFS(Sales_Data!N:N, Sales_Data!A:A, \">=\"&DATE({year},1,1), Sales_Data!A:A, \"<=\"&DATE({year},12,31))"

print("Finalizing file...")
wb.save(output_file)

size_mb = os.path.getsize(output_file) / (1024 * 1024)
print(f"Success! Created '{output_file}' ({size_mb:.2f} MB)")
