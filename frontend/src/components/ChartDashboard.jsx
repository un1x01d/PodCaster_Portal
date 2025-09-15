import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend } from "recharts";

export default function ChartDashboard({ data, config }) {
  const { type, xKey, yKey } = config;
  const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#9333ea"];

  if (type === "line") {
    return (
      <LineChart width={400} height={250} data={data}>
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey={yKey} stroke="#2563eb" />
      </LineChart>
    );
  }

  if (type === "bar") {
    return (
      <BarChart width={400} height={250} data={data}>
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey={yKey} fill="#16a34a" />
      </BarChart>
    );
  }

  if (type === "pie") {
    return (
      <PieChart width={400} height={250}>
        <Pie data={data} dataKey={yKey} nameKey={xKey} outerRadius={100} label>
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    );
  }

  return <p>Unknown chart type</p>;
}

