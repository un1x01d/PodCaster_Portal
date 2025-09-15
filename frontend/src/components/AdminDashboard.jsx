import { useEffect, useState } from "react";
import axios from "axios";
import AdminUpload from "./AdminUpload";
import DashboardCanvas from "./DashboardCanvas";

export default function AdminDashboard({ onLogout }) {
  const [data, setData] = useState([]);
  const [configs, setConfigs] = useState({ widgets: [], staticTable: {} });

  const fetchAll = async () => {
    const resData = await axios.get("http://localhost:4000/data/all");
    const resDash = await axios.get("http://localhost:4000/dashboards/admin");
    setData(resData.data);
    setConfigs(resDash.data);
  };

  useEffect(() => { fetchAll(); }, []);

  const saveConfigs = async (next) => {
    setConfigs(next);
    await axios.post("http://localhost:4000/dashboards/admin", next);
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h1>🛠️ Admin Dashboard</h1>
      <button className="secondary" onClick={onLogout}>Logout</button>
      <AdminUpload onUploaded={fetchAll} />
      {data.length ? (
        <DashboardCanvas who="admin" data={data} configs={configs} onSave={saveConfigs} staticTableConfig={{ filters: true }} />
      ) : <p>No data uploaded.</p>}
    </div>
  );
}

