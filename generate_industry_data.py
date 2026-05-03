import pandas as pd
import random
from datetime import datetime, timedelta

def random_date(start, end):
    return start + timedelta(days=random.randint(0, (end - start).days))

start_date = datetime(2020, 1, 1)
end_date = datetime(2026, 12, 31)
num_rows = 5000

# 1. TRUCKING BUSINESS (Logistics & Transport)
trucking_data = []
cargo_types = ["Electronics", "Produce", "Industrial Parts", "Retail Goods", "Hazardous Materials"]
service_types = ["Full Truckload (FTL)", "Less Than Truckload (LTL)", "Expedited Delivery", "Cold Chain"]
drivers = ["John Smith", "Maria Garcia", "David Chen", "Sarah Miller", "Robert Taylor"]

for i in range(num_rows):
    miles = random.randint(100, 2500)
    rate_per_mile = round(random.uniform(2.50, 4.50), 2)
    gross_revenue = round(miles * rate_per_mile, 2)
    fuel_cost = round(miles * random.uniform(0.40, 0.70), 2)
    tolls = random.randint(0, 150)
    driver_payout = round(gross_revenue * 0.35, 2)
    maintenance = round(miles * 0.05, 2)
    total_costs = fuel_cost + tolls + driver_payout + maintenance
    ebitda = round(gross_revenue - total_costs, 2)
    
    trucking_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Load ID": f"LD-{5000 + i}",
        "Driver Name": random.choice(drivers),
        "Truck ID": f"T-{random.randint(100, 150)}",
        "Cargo Type": random.choice(cargo_types),
        "Service Type": random.choice(service_types),
        "Miles Driven": miles,
        "Rate Per Mile": rate_per_mile,
        "Gross Revenue": gross_revenue,
        "Fuel Cost": fuel_cost,
        "Tolls and Fees": tolls,
        "Driver Payout": driver_payout,
        "Maintenance Cost": maintenance,
        "Operating Expenses": total_costs,
        "EBITDA": ebitda,
        "EBITDA Margin": f"{round((ebitda/gross_revenue)*100, 2)}%" if gross_revenue > 0 else "0%"
    })

pd.DataFrame(trucking_data).to_excel("trucking_business_5000_rows.xlsx", index=False)

# 2. HEALTH CARE (Clinical Services)
healthcare_data = []
depts = ["Cardiology", "Radiology", "Pediatrics", "General Surgery", "Orthopedics"]
visit_types = ["Initial Consultation", "Follow-up", "Diagnostic Test", "Minor Procedure", "Emergency"]
insurers = ["Aetna", "Blue Cross", "Medicare", "UnitedHealth", "Private Pay"]

for i in range(num_rows):
    base_billing = round(random.uniform(150, 3000), 2)
    insurance_reimbursement = round(base_billing * random.uniform(0.60, 0.85), 2)
    patient_copay = round(base_billing * 0.15, 2)
    total_revenue = insurance_reimbursement + patient_copay
    supply_cost = round(total_revenue * random.uniform(0.10, 0.25), 2)
    staff_overhead = round(total_revenue * 0.30, 2)
    ebitda = round(total_revenue - supply_cost - staff_overhead, 2)
    
    healthcare_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Patient ID": f"PAT-{10000 + i}",
        "Department": random.choice(depts),
        "Visit Type": random.choice(visit_types),
        "Insurance Carrier": random.choice(insurers),
        "Total Billing": base_billing,
        "Insurance Reimbursement": insurance_reimbursement,
        "Patient Co-pay": patient_copay,
        "Net Revenue": total_revenue,
        "Supplies Cost": supply_cost,
        "Staff Overhead": staff_overhead,
        "EBITDA": ebitda,
        "Net Profit": round(ebitda * 0.79, 2), # After 21% tax
        "Profit Margin": f"{round((ebitda/total_revenue)*100, 2)}%"
    })

pd.DataFrame(healthcare_data).to_excel("healthcare_business_5000_rows.xlsx", index=False)

# 3. ADVERTISING AGENCY (Media & Marketing)
ads_data = []
channels = ["Social Media", "Google Search", "Programmatic", "Out-of-Home", "Connected TV"]
services = ["Creative Production", "Media Buying", "Campaign Strategy", "Data Analytics"]
clients = ["Coke", "Apple", "Nike", "BMW", "Netflix", "Amazon"]

for i in range(num_rows):
    ad_spend_managed = round(random.uniform(5000, 100000), 2)
    management_fee_rate = random.uniform(0.08, 0.15)
    fee_revenue = round(ad_spend_managed * management_fee_rate, 2)
    production_revenue = round(random.uniform(2000, 15000), 2)
    total_revenue = fee_revenue + production_revenue
    staff_hours = random.randint(20, 100)
    staff_cost = round(staff_hours * 85, 2) # $85/hr cost
    direct_costs = round(production_revenue * 0.40, 2)
    ebitda = round(total_revenue - staff_cost - direct_costs, 2)
    
    ads_data.append({
        "Date": random_date(start_date, end_date).strftime('%Y-%m-%d'),
        "Campaign ID": f"CMP-{2000 + i}",
        "Client Name": random.choice(clients),
        "Media Channel": random.choice(channels),
        "Service Line": random.choice(services),
        "Ad Spend Managed": ad_spend_managed,
        "Fee Revenue": fee_revenue,
        "Production Revenue": production_revenue,
        "Total Net Revenue": total_revenue,
        "Staff Hours": staff_hours,
        "Staff Cost": staff_cost,
        "Production Direct Costs": direct_costs,
        "EBITDA": ebitda,
        "EBITDA Margin": f"{round((ebitda/total_revenue)*100, 2)}%" if total_revenue > 0 else "0%",
        "Net Profit": round(ebitda * 0.79, 2)
    })

pd.DataFrame(ads_data).to_excel("advertising_business_5000_rows.xlsx", index=False)
print("Three industry sheets generated: Trucking, Healthcare, and Advertising.")
