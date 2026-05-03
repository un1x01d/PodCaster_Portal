import pandas as pd
import random
from datetime import datetime, timedelta

def random_date(start, end):
    return start + timedelta(days=random.randint(0, (end - start).days))

start_date = datetime(2023, 1, 1)
end_date = datetime(2025, 12, 31)
num_rows_per_biz = 1000

# 1. B2B SOFTWARE (SaaS & Enterprise)
saas_data = []
for i in range(num_rows_per_biz):
    mrr = round(random.uniform(500, 5000), 2)
    saas_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Customer Name": f"Client {random.randint(100, 999)}",
        "Plan Type": random.choice(["Enterprise", "Professional", "Standard"]),
        "MRR": mrr,
        "Contract Length (Months)": random.choice([12, 24, 36]),
        "Support Tier": random.choice(["Gold", "Silver", "Platinum"]),
        "Active Users": random.randint(10, 500)
    })
pd.DataFrame(saas_data).to_excel("01_B2B_SaaS_Inventory.xlsx", index=False)

# 2. LOGISTICS & TRUCKING
logistics_data = []
for i in range(num_rows_per_biz):
    miles = random.randint(50, 1500)
    logistics_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Route ID": f"RT-{random.randint(1000, 9999)}",
        "Vehicle Type": random.choice(["Dry Van", "Reefer", "Flatbed"]),
        "Miles": miles,
        "Fuel Cost": round(miles * 0.45, 2),
        "Driver ID": f"DRV-{random.randint(10, 99)}",
        "Load Weight (Lbs)": random.randint(5000, 40000)
    })
pd.DataFrame(logistics_data).to_excel("02_Logistics_Operations.xlsx", index=False)

# 3. RETAIL / E-COMMERCE
retail_data = []
for i in range(num_rows_per_biz):
    price = round(random.uniform(10, 200), 2)
    qty = random.randint(1, 10)
    retail_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Order ID": f"ORD-{random.randint(50000, 99999)}",
        "Product Category": random.choice(["Apparel", "Electronics", "Home Decor", "Beauty"]),
        "Unit Price": price,
        "Quantity": qty,
        "Total Sale": round(price * qty, 2),
        "Payment Method": random.choice(["Credit Card", "PayPal", "Stripe"])
    })
pd.DataFrame(retail_data).to_excel("03_Retail_Sales_Export.xlsx", index=False)

# 4. HEALTHCARE SERVICES
health_data = []
for i in range(num_rows_per_biz):
    health_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Patient Reference": f"REF-{random.randint(10000, 99999)}",
        "Department": random.choice(["Pediatrics", "Cardiology", "Dermatology", "Orthopedics"]),
        "Procedure Code": f"CPT-{random.randint(1000, 9000)}",
        "Billing Amount": round(random.uniform(150, 2500), 2),
        "Insurance Provider": random.choice(["BlueShield", "Aetna", "Medicare"]),
        "Patient Wait Time (Mins)": random.randint(5, 120)
    })
pd.DataFrame(health_data).to_excel("04_Healthcare_Billing_Log.xlsx", index=False)

# 5. ADVERTISING / MEDIA AGENCY
ads_data = []
for i in range(num_rows_per_biz):
    spend = round(random.uniform(1000, 50000), 2)
    ads_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Campaign Name": f"Campaign_{random.choice(['Summer', 'Holiday', 'Brand', 'Growth'])}",
        "Channel": random.choice(["Social Media", "Search", "Display", "Video"]),
        "Ad Spend": spend,
        "Impressions": random.randint(10000, 1000000),
        "Clicks": random.randint(500, 10000),
        "Conversions": random.randint(5, 200)
    })
pd.DataFrame(ads_data).to_excel("05_Advertising_Performance.xlsx", index=False)

print("Five clean industry-specific sheets generated.")
