import { useState } from "react";

export default function WidgetBuilder({ columns, onSave, initial, onCancel }) {
  const [type, setType] = useState(initial?.type || "table");
  const [xKey, setXKey] = useState(initial?.xKey || "");
  const [yKey, setYKey] = useState(initial?.yKey || "");
  const [field, setField] = useState(initial?.field || "");
  const [cols, setCols] = useState(initial?.columns || columns || []);

  const submit = () => {
    onSave({
      type,
      xKey,
      yKey,
      field,
      columns: cols,
      layout: initial?.layout || { x: 0, y: Infinity, w: 4, h: 6 }
    });
  };

  return (
    <div className="modal">
      <div className="modal-card">
        <h2>{initial ? "Edit Widget" : "Add Widget"}</h2>

        <label>Type:</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="table">Table</option>
          <option value="line">Line Chart</option>
          <option value="bar">Bar Chart</option>
          <option value="pie">Pie Chart</option>
          <option value="kpi">KPI</option>
        </select>

        {type === "table" && (
          <>
            <label>Columns:</label>
            <select
              multiple
              value={cols}
              onChange={(e) =>
                setCols([...e.target.selectedOptions].map(o => o.value))
              }
            >
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </>
        )}

        {["line", "bar", "pie"].includes(type) && (
          <>
            <label>X Key:</label>
            <select value={xKey} onChange={(e) => setXKey(e.target.value)}>
              <option value="">--</option>
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label>Y Key:</label>
            <select value={yKey} onChange={(e) => setYKey(e.target.value)}>
              <option value="">--</option>
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </>
        )}

        {type === "kpi" && (
          <>
            <label>Field:</label>
            <select value={field} onChange={(e) => setField(e.target.value)}>
              <option value="">--</option>
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </>
        )}

        <div style={{ marginTop: "1rem" }}>
          <button onClick={submit}>{initial ? "Save" : "Add"}</button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

