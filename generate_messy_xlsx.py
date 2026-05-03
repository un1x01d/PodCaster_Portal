import pandas as pd
import random
from datetime import datetime

# We will build this row by row to ensure maximum "messiness"
data = []

# 1. Noise at the top (Metadata/Comments)
data.append(["PROJECT ALPHA - CONSOLIDATED INTAKE LOG", "", "", "", ""])
data.append(["Exported by: Legacy System 4.2", "", "Timestamp: 2026-05-03", "", ""])
data.append(["CONFIDENTIAL", "", "", "", ""])
data.append(["", "", "", "", ""]) # Empty spacer

# 2. The "Headers" (Non-standard and shifted)
headers = ["Record Details", "When", "Money Stuff", "Status", "Misc Info"]
data.append(headers)

# 3. Messy Data Rows
clients = ["GlobalCorp", "TechNova", "Starlight", "AlphaLog"]
regions = ["North", "South", "EMEA", "APAC"]
products = ["SaaS", "Consulting", "Hardware", "Support"]

for i in range(50):
    # Messy Record Details: Nested data
    client = random.choice(clients)
    prod = random.choice(products)
    reg = random.choice(regions)
    record_details = f"{client} | {prod} ({reg}) ID:{random.randint(500, 999)}"
    
    # Messy Dates: Mixed formats
    date_choice = random.randint(1, 4)
    if date_choice == 1:
        when = datetime(2023, random.randint(1,12), random.randint(1,28)).strftime("%m/%d/%Y")
    elif date_choice == 2:
        when = datetime(2024, random.randint(1,12), random.randint(1,28)).strftime("%d-%b-%y")
    elif date_choice == 3:
        when = f"Q{random.randint(1,4)} 2025"
    else:
        when = "Last Tuesday" # Very hard for deterministic parsers
        
    # Messy Money: Mixed currencies and suffixes
    amount = random.randint(1000, 50000)
    currency = random.choice(["$", "£", "EUR", ""])
    money_stuff = f"{currency}{amount} {random.choice(['USD', 'approx', 'net', 'gross', ''])}".strip()
    
    # Status: Inconsistent casing and typos
    status = random.choice(["Paid", "pnding", "CANCELLED", "Complete", "WAITING", "re-fnd"])
    
    # Misc Info: Key-value noise
    misc = f"mgr:{random.choice(['js', 'mg', 'dc'])} | tax:{random.choice(['incl', 'excl'])}"
    
    data.append([record_details, when, money_stuff, status, misc])

# 4. Inject random empty rows
for _ in range(5):
    data.insert(random.randint(6, 40), ["", "", "", "", ""])

# 5. Summary rows at the bottom (Calculations mixed with labels)
data.append(["", "", "", "", ""])
data.append(["TOTALS", "", "Check sum: $450,200 approx", "Audited", "Verified by JS"])
data.append(["END OF FILE", "", "", "", ""])

df = pd.DataFrame(data)
df.to_excel("messy_intake_data.xlsx", index=False, header=False)
print("File generated: messy_intake_data.xlsx")
