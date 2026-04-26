import csv
import random
from datetime import datetime, timedelta

# Configuration
NUM_ROWS = 20000
OUTPUT_FILE = "grocery_transactions.csv"

# Data Pools
stores = [
    {"id": "101", "name": "Fresh Market", "city": "Rochester", "state": "NY", "region": "North-East"},
    {"id": "102", "name": "Fresh Market", "city": "Buffalo", "state": "NY", "region": "North-East"},
    {"id": "103", "name": "Fresh Market", "city": "Syracuse", "state": "NY", "region": "North-East"}
]

products = [
    # Dept, Category, Sub-Cat, Brand, Style, Name, Price, COGS
    ("Produce", "Vegetables", "Leafy Greens", "GreenLeaf", "GL-01", "Organic Spinach", 3.99, 1.20),
    ("Dairy", "Milk & Cream", "Whole Milk", "DairyPure", "DP-10", "Gallon Whole Milk", 4.50, 2.10),
    ("Meat", "Beef", "Steaks", "Butcher's Choice", "BC-05", "Ribeye Steak 12oz", 15.99, 8.50),
    ("Bakery", "Bread", "Sourdough", "Artisan Oven", "AO-22", "Fresh Sourdough Loaf", 5.49, 1.80),
    ("Frozen", "Ice Cream", "Pints", "ColdScoop", "CS-09", "Vanilla Bean Pint", 6.25, 3.00),
    ("Produce", "Fruit", "Apples", "Local Farms", "LF-02", "Honeycrisp Apples (lb)", 2.49, 0.90),
    ("Beverages", "Soda", "Cola", "FizzCo", "FZ-01", "12-Pack Cola", 7.99, 4.00),
    ("Pantry", "Pasta", "Dry Pasta", "BellaItalia", "BI-14", "Penne Rigate 16oz", 1.89, 0.60),
]

pay_methods = ["Visa", "Mastercard", "Cash", "Apple Pay", "AmEx", "EBT"]
channels = ["In-Store", "Online", "BOPIS", "Curbside"]
sources = ["POS", "Website", "iOS App", "Android App"]
age_groups = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
tiers = ["None", "Bronze", "Silver", "Gold", "Platinum"]

headers = [
    "Transaction ID", "Transaction Date", "Transaction Time", "Store #", "Store Name", 
    "Store City", "Store State", "Region", "Register #", "Cashier ID", "Customer ID", 
    "Customer Age Group", "Loyalty Member?", "Loyalty Tier", "Sales Channel", 
    "Order Source", "SKU", "Style #", "Product Name", "Department", "Category", 
    "Sub-Category", "Brand", "Gender / Fit", "Size", "Color", "Material", "Season", 
    "Collection", "Quantity", "List Price ($)", "Unit Selling Price ($)", "Markdown %", 
    "Promotion Code", "Gross Sales ($)", "Discount Amount ($)", "Net Sales ($)", 
    "COGS ($)", "Gross Profit ($)", "Gross Margin %", "Tax Rate %", "Sales Tax ($)", 
    "Shipping Fee ($)", "Total Collected ($)", "Payment Method", "Return Flag", 
    "Return Amount ($)", "Inventory Location", "Stock On Hand After Sale", "Receipt Notes"
]

with open(OUTPUT_FILE, mode='w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(headers)
    
    start_date = datetime(2024, 1, 1)
    
    for i in range(1, NUM_ROWS + 1):
        # Logic for randomness
        store = random.choice(stores)
        prod = random.choice(products)
        qty = random.randint(1, 5)
        is_loyalty = random.choice(["Yes", "No"])
        tier = random.choice(tiers) if is_loyalty == "Yes" else "None"
        
        # Financials
        list_price = prod[6]
        markdown = random.choice([0, 0, 0, 10, 20]) # Mostly full price
        unit_price = round(list_price * (1 - markdown/100), 2)
        gross_sales = round(unit_price * qty, 2)
        disc_amt = round((list_price - unit_price) * qty, 2)
        net_sales = gross_sales
        total_cogs = round(prod[7] * qty, 2)
        gross_profit = round(net_sales - total_cogs, 2)
        margin_pct = round((gross_profit / net_sales) * 100, 2) if net_sales > 0 else 0
        tax_rate = 4.0 # Grocery food tax often lower
        tax_amt = round(net_sales * (tax_rate / 100), 2)
        shipping = 0.00 if random.random() > 0.1 else 5.99
        total_collected = round(net_sales + tax_amt + shipping, 2)
        
        # Dates
        current_date = start_date + timedelta(days=random.randint(0, 700), minutes=random.randint(0, 1440))
        
        writer.writerow([
            f"TXN-GRC-{100000 + i}",
            current_date.strftime("%Y-%m-%d"),
            current_date.strftime("%H:%M:%S"),
            store["id"], store["name"], store["city"], store["state"], store["region"],
            f"REG-0{random.randint(1, 8)}",
            f"EMP-{random.randint(500, 550)}",
            f"CUST-{random.randint(200000, 300000)}",
            random.choice(age_groups),
            is_loyalty, tier,
            random.choice(channels),
            random.choice(sources),
            f"SKU-FOOD-{random.randint(1000, 9999)}",
            prod[4], prod[5], prod[0], prod[1], prod[2], prod[3],
            "N/A", "N/A", "N/A", "Fresh/Packaged", "Year-Round", "Pantry Essentials",
            qty, f"{list_price:.2f}", f"{unit_price:.2f}", f"{markdown:.2f}",
            "N/A" if markdown == 0 else "SAVE10",
            f"{gross_sales:.2f}", f"{disc_amt:.2f}", f"{net_sales:.2f}",
            f"{total_cogs:.2f}", f"{gross_profit:.2f}", f"{margin_pct:.2f}",
            f"{tax_rate:.2f}", f"{tax_amt:.2f}", f"{shipping:.2f}", f"{total_collected:.2f}",
            random.choice(pay_methods),
            "No", "0.00", "Aisle " + str(random.randint(1, 20)),
            random.randint(10, 200), ""
        ])

print(f"Generated {NUM_ROWS} lines in {OUTPUT_FILE}")
