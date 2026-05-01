import pandas as pd
import numpy as np
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

output_file = "global_ops_2026_heavy.xlsx"
# Increased row count and added "Notes" column to increase file size realistically
num_rows = 150000 

print(f"Generating {num_rows} rows of high-fidelity business data...")

# Business Context
regions = ["North America", "EMEA", "APAC", "LATAM", "DACH"]
sectors = ["Healthcare", "FinTech", "Energy", "Logistics", "Aerospace"]
vendors = ["Global Dynamics", "Stellar Systems", "Prime Logistics", "Nexus Energy"]

data = []
for i in range(num_rows):
    region = regions[i % len(regions)]
    sector = sectors[i % len(sectors)]
    vendor = vendors[i % len(vendors)]
    
    qty = (i % 50) + 1
    unit_price = 1000.0 + (i % 5000)
    discount = 0.05 + (0.01 * (i % 15))
    tax = 0.12
    
    # Adding a realistic "Notes" field with unique but structured data to bloat size properly
    notes = f"System-generated record for {sector} division in {region}. Compliance verified by {vendor} audit team."
    
    data.append([
        f"ORD-{2026}-{i:06d}",
        "2026-Q1",
        region, sector, vendor,
        qty, unit_price, discount, tax,
        "Verified", notes
    ])

print("Building workbook...")
wb = Workbook()
ws = wb.active
ws.title = "Dataset"

headers = ["Order_ID", "Fiscal_Period", "Region", "Sector", "Vendor", "Qty", "Unit_Price", "Disc_Pct", "Tax_Pct", "Status", "Audit_Notes", "Gross_Total", "Net_Total"]
ws.append(headers)

# Use bold headers
for cell in ws[1]:
    cell.font = Font(bold=True)
    cell.fill = PatternFill(start_color="D3D3D3", end_color="D3D3D3", fill_type="solid")

print("Injecting data and formulas...")
for r_idx, row_data in enumerate(data, start=2):
    ws.append(row_data)
    # Gross_Total = F * G
    ws.cell(row=r_idx, column=12).value = f"=F{r_idx}*G{r_idx}"
    # Net_Total = (F*G)*(1-H)*(1+I)
    ws.cell(row=r_idx, column=13).value = f"=(F{r_idx}*G{r_idx})*(1-H{r_idx})*(1+I{r_idx})"

ws.freeze_panes = "A2"

# Summary Sheet
ws_sum = wb.create_sheet("Executive_Summary")
ws_sum["A1"] = "Metric"
ws_sum["B1"] = "Value"
ws_sum["A2"] = "Total Net Value"
ws_sum["B2"] = "=SUM(Dataset!M:M)"
ws_sum["A3"] = "Total Units"
ws_sum["B3"] = "=SUM(Dataset!F:F)"

print("Saving (this will take a moment due to formula count)...")
wb.save(output_file)

size_mb = os.path.getsize(output_file) / (1024 * 1024)
print(f"Final File: '{output_file}' ({size_mb:.2f} MB)")
