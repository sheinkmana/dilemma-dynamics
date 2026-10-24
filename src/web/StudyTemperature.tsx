import { studies, type StudyTemperature } from './studyData.js';

export function StudyTemperature({
  value,
  onChange,
}: {
  value: StudyTemperature;
  onChange: (value: StudyTemperature) => void;
}) {
  return (
    <div className="results-filter study-temperature">
      <label htmlFor="study-temperature">Study temperature</label>
      <select
        id="study-temperature"
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as StudyTemperature)}
      >
        {([0, 1] as const).map((temperature) => (
          <option key={temperature} value={temperature}>
            Temperature {temperature} · {studies[temperature].date}
          </option>
        ))}
      </select>
      <p className="results-note">
        1,776 completed episodes per temperature · same 24-block environment schedule.
      </p>
    </div>
  );
}
