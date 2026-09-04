import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const chartMargin = { top: 12, right: 18, left: 0, bottom: 8 };

export default function TruckCharts({ data, loading }) {
  const { t } = useTranslation();
  const hasData = Array.isArray(data) && data.length > 0;

  function renderEmpty(text) {
    return <div className="empty-state">{text}</div>;
  }

  function renderChart(dataKey, color, label) {
    return (
      <ResponsiveContainer width="100%" height={240} minWidth={200}>
        <LineChart data={data} margin={chartMargin}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" />
          <XAxis dataKey="time" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickMargin={8} />
          <YAxis tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
          <Tooltip
            cursor={{ stroke: color, strokeWidth: 1 }}
            contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
          />
          <Line type="monotone" dataKey={dataKey} name={label} stroke={color} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="trucks-charts-grid">
      <div className="panel truck-chart-panel">
        <div className="chart-title">{t('Speed (last 60 minutes)')}</div>
        <div className="chart-wrapper">
          {loading && renderEmpty(t('Loading chart...'))}
          {!loading && !hasData && renderEmpty(t('No telemetry data available'))}
          {!loading && hasData && renderChart('speedKmh', '#0ea5e9', t('Speed'))}
        </div>
      </div>

      <div className="panel truck-chart-panel">
        <div className="chart-title">{t('Estimated CO2 (last 60 minutes)')}</div>
        <div className="chart-wrapper">
          {loading && renderEmpty(t('Loading chart...'))}
          {!loading && !hasData && renderEmpty(t('No telemetry data available'))}
          {!loading && hasData && renderChart('co2Kg', '#f97316', t('CO2'))}
        </div>
      </div>
    </div>
  );
}
