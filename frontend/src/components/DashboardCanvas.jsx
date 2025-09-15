import GridLayout from "react-grid-layout";
import TableDashboard from "./TableDashboard";
import ChartDashboard from "./ChartDashboard";
import KPIDashboard from "./KPIDashboard";
import WidgetBuilder from "./WidgetBuilder";
import { useState } from "react";

export default function DashboardCanvas({ data, configs, onSave, staticTableConfig }) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editIndex, setEditIndex] = useState(null);

  const layout = [
    {
      i: "static-table",
      x: configs.staticTable?.layout?.x ?? 0,
      y: configs.staticTable?.layout?.y ?? 0,
      w: configs.staticTable?.layout?.w ?? 12,
      h: configs.staticTable?.layout?.h ?? 12
    },
    ...configs.widgets.map((c, i) => ({ i: `widget-${i}`, ...c.layout }))
  ];

  const handleLayoutChange = (newLayout) => {
    const staticLayout = newLayout.find((l) => l.i === "static-table");
    const widgetLayouts = newLayout.filter((l) => l.i.startsWith("widget-"));
    const updatedWidgets = configs.widgets.map((w, i) => ({
      ...w,
      layout: widgetLayouts[i]
    }));
    onSave({ staticTable: { layout: staticLayout }, widgets: updatedWidgets });
  };

  const addOrUpdateWidget = (widget) => {
    const updated = [...configs.widgets];
    if (editIndex !== null) updated[editIndex] = widget;
    else updated.push(widget);
    onSave({ ...configs, widgets: updated });
    setShowBuilder(false);
    setEditIndex(null);
  };

  const deleteWidget = (i) => {
    const updated = configs.widgets.filter((_, idx) => idx !== i);
    onSave({ ...configs, widgets: updated });
  };

  const renderWidget = (config) => {
    if (!config) return null;
    if (config.type === "table") return <TableDashboard data={data} config={config} />;
    if (["line", "bar", "pie"].includes(config.type) && config.xKey && config.yKey)
      return <ChartDashboard data={data} config={config} />;
    if (config.type === "kpi" && config.field)
      return <KPIDashboard data={data} config={config} />;
    return <p style={{ color: "red" }}>⚠️ Invalid widget config</p>;
  };

  return (
    <div>
      <button onClick={() => setShowBuilder(true)}>➕ Add Widget</button>
      {showBuilder && (
        <WidgetBuilder
          columns={Object.keys(data[0] || {})}
          onSave={addOrUpdateWidget}
          initial={editIndex !== null ? configs.widgets[editIndex] : null}
          onCancel={() => { setShowBuilder(false); setEditIndex(null); }}
        />
      )}
      <GridLayout
        layout={layout}
        cols={24} // ✅ finer grid (more flexible sizing)
        rowHeight={30}
        width={1600}
        isDraggable
        isResizable
        maxRows={Infinity} // ✅ unlimited vertical growth
        resizeHandles={['s', 'w', 'e', 'n', 'sw', 'se', 'nw', 'ne']} // ✅ resize from all sides
        onLayoutChange={handleLayoutChange}
      >
        <div key="static-table" style={{ width: "100%", height: "100%" }}>
          <TableDashboard data={data} config={staticTableConfig || { filters: true }} />
        </div>
        {configs.widgets.map((w, i) => (
          <div key={`widget-${i}`}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => { setEditIndex(i); setShowBuilder(true); }}>✏️</button>
              <button className="danger" onClick={() => deleteWidget(i)}>🗑️</button>
            </div>
            {renderWidget(w)}
          </div>
        ))}
      </GridLayout>
    </div>
  );
}

