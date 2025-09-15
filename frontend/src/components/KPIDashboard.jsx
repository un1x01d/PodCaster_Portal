export default function KPIDashboard({ data, config }) {
  const { field } = config;
  const sum = data.reduce((acc, row) => acc + Number(row[field] || 0), 0);

  return (
    <div style={{ padding: "1rem", background: "#f3f4f6", borderRadius: "8px", textAlign: "center" }}>
      <h3>KPI: {field}</h3>
      <p style={{ fontSize: "2rem", fontWeight: "bold" }}>{sum}</p>
    </div>
  );
}

