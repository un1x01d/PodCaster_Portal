import pandas as pd
import random
from datetime import datetime, timedelta

def random_date(start, end):
    return start + timedelta(days=random.randint(0, (end - start).days))

start_date = datetime(2023, 1, 1)
end_date = datetime(2025, 12, 31)
num_rows = 1000

with pd.ExcelWriter("multi_industry_data.xlsx", engine="openpyxl") as writer:
    # 1. B2B SaaS
    saas_data = []
    for i in range(num_rows):
        saas_data.append({
            "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
            "Customer": f"Client {random.randint(100, 999)}",
            "Plan": random.choice(["Enterprise", "Professional", "Standard"]),
            "MRR": round(random.uniform(500, 5000), 2),
            "Users": random.randint(10, 500)
        })
    pd.DataFrame(saas_data).to_excel(writer, sheet_name="B2B_SaaS", index=False)

    # 2. Logistics
    logistics_data = []
    for i in range(num_rows):
        miles = random.randint(50, 1500)
        logistics_data.append({
            "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
            "Route ID": f"RT-{random.randint(1000, 9999)}",
            "Vehicle": random.choice(["Dry Van", "Reefer", "Flatbed"]),
            "Miles": miles,
            "Fuel Cost": round(miles * 0.45, 2)
        })
    pd.DataFrame(logistics_data).to_excel(writer, sheet_name="Logistics", index=False)

    # 3. Retail
    retail_data = []
    for i in range(num_rows):
        price = round(random.uniform(10, 200), 2)
        qty = random.randint(1, 10)
        retail_data.append({
            "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
            "Order ID": f"ORD-{random.randint(50000, 99999)}",
            "Category": random.choice(["Apparel", "Electronics", "Home Decor"]),
            "Total Sale": round(price * qty, 2)
        })
    pd.DataFrame(retail_data).to_excel(writer, sheet_name="Retail", index=False)

    # 4. Healthcare
    health_data = []
    for i in range(num_rows):
        health_data.append({
            "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
            "Patient REF": f"REF-{random.randint(10000, 99999)}",
            "Dept": random.choice(["Pediatrics", "Cardiology", "Orthopedics"]),
            "Billing": round(random.uniform(150, 2500), 2)
        })
    pd.DataFrame(health_data).to_excel(writer, sheet_name="Healthcare", index=False)

    # 5. Advertising
    ads_data = []
    for i in range(num_rows):
        ads_data.append({
            "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
            "Campaign": f"Campaign_{random.choice(['Summer', 'Holiday', 'Brand'])}",
            "Channel": random.choice(["Social", "Search", "Display"]),
            "Spend": round(random.uniform(1000, 50000), 2)
        })
    pd.DataFrame(ads_data).to_excel(writer, sheet_name="Advertising", index=False)

print("Combined multi-tab file generated: multi_industry_data.xlsx")
