import { useEffect, useState } from "react";
import axios from "axios";
import DashboardCanvas from "./DashboardCanvas";

export default function ClientDashboard({ clientId, onLogout }) {
  const [data, setData] = useState([]);
  const [configs, setConfigs] = useState({ widgets: [], staticTable: {} });

  const fetchAll = async () => {
    const resData = await axios.get(`http://localhost:4000/data/${clientId}`);
    const resDash = await axios.get(`http://localhost:4000/dashboards/${clientId}`);
    setData(resData.data);
    setConfigs(resDash.data);
  };

  useEffect(() => { fetchAll(); }, [clientId]);

  const saveConfigs = async (next) => {
    setConfigs(next);
    await axios.post(`http://localhost:4000/dashboards/${clientId}`, next);
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h1>👤 Client Dashboard</h1>
      <button className="secondary" onClick={onLogout}>Logout</button>
      {data.length ? (
        <DashboardCanvas who="client" data={data} configs={configs} onSave={saveConfigs} staticTableConfig={{ filters: true }} />
      ) : <p>No data for this client.</p>}
    </div>
  );
}

