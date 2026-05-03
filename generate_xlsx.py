import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

# Configuration
num_rows = 5000
clients = ["GlobalCorp", "TechNova", "Starlight Media", "Alpha Logistics", "BlueSky Retail", "Nexus Health", "Omega Energy", "Peak Finance"]
regions = ["North America", "EMEA", "APAC", "LATAM"]
categories = ["Software", "Hardware", "Consulting", "Support"]
services = ["SaaS Subscription", "Implementation", "Maintenance", "Strategy Audit", "Cloud Hosting"]

def random_date(start, end):
    return start + timedelta(days=random.randint(0, (end - start).days))

start_date = datetime(2020, 1, 1)
end_date = datetime(2026, 12, 31)

data = []
for i in range(num_rows):
    date = random_date(start_date, end_date).strftime('%Y-%m-%d')
    unit_price = round(random.uniform(50, 550), 2)
    quantity = random.randint(1, 100)
    gross_revenue = round(unit_price * quantity, 2)
    discount_rate = round(random.uniform(0, 0.15), 4)
    net_revenue = round(gross_revenue * (1 - discount_rate), 2)
    cogs_percent = round(random.uniform(0.3, 0.5), 4)
    cogs_amount = round(net_revenue * cogs_percent, 2)
    marketing_spend = round(net_revenue * random.uniform(0.05, 0.15), 2)
    fixed_costs = round(random.uniform(500, 700), 2)
    op_expenses = round(marketing_spend + fixed_costs, 2)
    ebitda = round(net_revenue - cogs_amount - op_expenses, 2)
    ebitda_margin = round(ebitda / net_revenue, 4) if net_revenue != 0 else 0
    tax_rate = 0.21
    net_profit = round(ebitda * (1 - tax_rate), 2)

    data.append({
        "Date": date,
        "Transaction ID": f"TXN-{1000 + i}",
        "Client Name": random.choice(clients),
        "Region": random.choice(regions),
        "Product Category": random.choice(categories),
        "Service Line": random.choice(services),
        "Unit Price": unit_price,
        "Quantity": quantity,
        "Gross Revenue": gross_revenue,
        "Discount Rate": f"{round(discount_rate * 100, 2)}%",
        "Net Revenue": net_revenue,
        "COGS Percent": f"{round(cogs_percent * 100, 2)}%",
        "COGS Amount": cogs_amount,
        "Marketing Spend": marketing_spend,
        "Fixed Costs": fixed_costs,
        "Operating Expenses": op_expenses,
        "EBITDA": ebitda,
        "EBITDA Margin": f"{round(ebitda_margin * 100, 2)}%",
        "Tax Rate": "21%",
        "Net Profit": net_profit
    })

df = pd.DataFrame(data)
df.to_excel("financial_analysis_5000_rows.xlsx", index=False, engine='openpyxl')
print("File generated: financial_analysis_5000_rows.xlsx")
