import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ComposedChart } from 'recharts';
import type { DailyAvailability, ProjectSummary, FungibleTimeSummary } from '../types';

interface TimeAvailableChartProps {
  data: DailyAvailability[];
}

export const TimeAvailableChart: React.FC<TimeAvailableChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return <div className="text-center p-4 text-gray-500">No availability data to display.</div>;
  }
  
  // Transform data to create stacked effect: purple (available) on bottom, grey (consumed) on top
  const chartData = data.map(d => ({
    ...d,
    consumedHours: Math.max(0, d.totalHours - d.availableHours)
  }));
  
  // Calculate max value for proper scaling based on total hours
  const maxValue = Math.ceil(Math.max(...data.map(d => d.totalHours)));
  
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis dataKey="date" stroke="#4A5568" tick={{ fontSize: 10 }} interval={0} />
        <YAxis 
          label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: '#4A5568' }} 
          stroke="#4A5568" 
          tick={{ fontSize: 12 }}
          ticks={Array.from({ length: maxValue + 1 }, (_, i) => i)}
          domain={[0, maxValue]}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '0.5rem', borderColor: '#cbd5e0' }}
          formatter={(value: number, name: string) => {
            if (name === 'availableHours') return [value.toFixed(1) + 'h', 'Still Available'];
            if (name === 'consumedHours') return [value.toFixed(1) + 'h', 'Task Time'];
            return [value.toFixed(1) + 'h', name];
          }}
        />
        <Legend />
        {/* Bottom section: available hours (purple) */}
        <Bar dataKey="availableHours" stackId="timeStack" fill="#8884d8" name="Still Available" radius={[0, 0, 0, 0]} />
        {/* Top section: task time consumed (grey) */}
        <Bar dataKey="consumedHours" stackId="timeStack" fill="#64748b" name="Task Time" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

interface ProjectTimeChartProps {
  data: ProjectSummary[];
}

export const ProjectTimeChart: React.FC<ProjectTimeChartProps> = ({ data }) => {
   if (!data || data.length === 0) {
    return <div className="text-center p-4 text-gray-500">No project data to display.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis type="number" stroke="#4A5568" label={{ value: 'Hours', position: 'insideBottom', dy:10, fill: '#4A5568' }}/>
        <YAxis type="category" dataKey="project" width={100} stroke="#4A5568" tick={{ fontSize: 12 }} />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '0.5rem', borderColor: '#cbd5e0' }}
          formatter={(value: number) => [value.toFixed(1) + ' hours']}
        />
        <Bar dataKey="totalHours" name="Total Hours" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

interface FungibleTimeChartProps {
  data: FungibleTimeSummary[];
}

export const FungibleTimeChart: React.FC<FungibleTimeChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return <div className="text-center p-4 text-gray-500">No fungible time data to display.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis type="number" stroke="#4A5568" label={{ value: 'Hours', position: 'insideBottom', dy: 10, fill: '#4A5568' }} />
        <YAxis type="category" dataKey="project" width={100} stroke="#4A5568" tick={{ fontSize: 12 }} />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '0.5rem', borderColor: '#cbd5e0' }}
          formatter={(value: number) => [value.toFixed(1) + ' hours']}
        />
        <Bar dataKey="totalHours" name="Total Hours" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
