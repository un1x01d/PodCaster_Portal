import pandas as pd
import numpy as np
import os
from openpyxl import Workbook
from openpyxl.utils import get_column_letter

output_file = "enterprise_operations_2026.xlsx"
num_rows = 80000  # Calculated to hit ~20MB with realistic business data

print(f"Generating {num_rows} rows of realistic business data...")

# Realistic Data Pools
regions = ["North America", "EMEA", "APAC", "LATAM"]
countries = {
    "North America": ["USA", "Canada"],
    "EMEA": ["UK", "Germany", "France", "UAE"],
    "APAC": ["Singapore", "Japan", "Australia"],
    "LATAM": ["Brazil", "Mexico"]
}
sectors = ["Healthcare", "FinTech", "Manufacturing", "Energy", "Retail"]
product_lines = {
    "Healthcare": ["MRI Scanner", "Patient Monitor", "Dialysis Kit"],
    "FinTech": ["Payment Gateway", "Trading Terminal", "Fraud Shield"],
    "Manufacturing": ["Robotic Arm", "CNC Controller", "3D Printer"],
    "Energy": ["Solar Array", "Grid Inverter", "Battery Storage"],
    "Retail": ["POS System", "Inventory Bot", "Digital Signage"]
}

# Generate Base Data
data = []
for i in range(num_rows):
    region = np.random.choice(regions)
    country = np.random.choice(countries[region])
    sector = np.random.choice(sectors)
    product = np.random.choice(product_lines[sector])
    
    qty = np.random.randint(1, 50)
    unit_price = np.random.uniform(500, 15000)
    # Discounts are deeper for Energy/Healthcare, tighter for Retail
    disc_base = 0.05 if sector == "Retail" else 0.15
    discount_pct = np.random.uniform(0, disc_base)
    tax_rate = 0.05 if country == "UAE" else 0.19 if country == "Germany" else 0.08
    
    data.append([
        f"ORD-2026-{100000+i}",       # Order_ID
        pd.Timestamp("2026-01-01") + pd.Timedelta(days=np.random.randint(0, 120)), # Date
        region, country, sector, product,
        qty, round(unit_price, 2), round(discount_pct, 4), round(tax_rate, 2),
        "Active" if np.random.random() > 0.05 else "Pending Approval" # Status
    ])

df = pd.DataFrame(data, columns=[
    "Order_ID", "Date", "Region", "Country", "Business_Sector", "Product_Line",
    "Quantity", "Unit_Price_USD", "Discount_Pct", "Tax_Rate_Pct", "Workflow_Status"
])

print("Writing to Excel with formulas...")
# We use openpyxl directly to ensure formulas are written as cell objects
wb = Workbook()
ws = wb.active
ws.title = "Global_Sales_Operations"

# Write Headers
headers = list(df.columns) + ["Gross_Revenue", "Discount_Amount", "Net_Sales", "Tax_Amount", "Total_Contract_Value"]
ws.append(headers)

# Convert DF to list for faster appending
rows = df.values.tolist()

for r_idx, row_data in enumerate(rows, start=2):
    ws.append(row_data)
    # Define Column Letters
    # G: Qty, H: Price, I: Disc%, J: Tax%
    # K: Status (at index 11)
    # L: Gross_Rev (Col 12) = G * H
    # M: Disc_Amt (Col 13) = L * I
    # N: Net_Sales (Col 14) = L - M
    # O: Tax_Amt  (Col 15) = N * J
    # P: Total_Val (Col 16) = N + O
    ws.cell(row=r_idx, column=12).value = f"=G{r_idx}*H{r_idx}"
    ws.cell(row=r_idx, column=13).value = f"=L{r_idx}*I{r_idx}"
    ws.cell(row=r_idx, column=14).value = f"=L{r_idx}-M{r_idx}"
    ws.cell(row=r_idx, column=15).value = f"=N{r_idx}*J{r_idx}"
    ws.cell(row=r_idx, column=16).value = f"=N{r_idx}+O{r_idx}"

# Summary Sheet
ws_sum = wb.create_sheet("Executive_Summary")
ws_sum["A1"] = "Global Performance Metrics"
ws_sum["A3"] = "Total Projected Revenue"
ws_sum["B3"] = "=SUM(Global_Sales_Operations!P:P)"
ws_sum["A4"] = "Average Transaction Value"
ws_sum["B4"] = "=AVERAGE(Global_Sales_Operations!P:P)"
ws_sum["A5"] = "Total Units Shipped"
ws_sum["B5"] = "=SUM(Global_Sales_Operations!G:G)"

# Formatting
ws.freeze_panes = "A2"

print("Saving file...")
wb.save(output_file)

size_mb = os.path.getsize(output_file) / (1024 * 1024)
print(f"Done! Created '{output_file}' ({size_mb:.2f} MB)")
