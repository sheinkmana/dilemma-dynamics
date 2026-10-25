import { useId } from 'react';
import type { StudyTemperature } from './studyData.js';

export function StudyTemperature({
  value,
  onChange,
}: {
  value: StudyTemperature;
  onChange: (value: StudyTemperature) => void;
}) {
  const id = useId();
  return (
    <div className="results-filter study-temperature">
      <label htmlFor={id}>Study temperature</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as StudyTemperature)}
      >
        {([0, 1] as const).map((temperature) => (
          <option key={temperature} value={temperature}>
            Temperature {temperature}
          </option>
        ))}
      </select>
      <p className="results-note">
        3,552 completed episodes per temperature · 48 matched blocks · interleaved in one campaign.
      </p>
    </div>
  );
}
