'use client';

import { SCENARIOS, type ScenarioId, type ScenarioProfile } from '@datasourceintelligence/shared';

interface ScenarioSwitcherProps {
  scenario: ScenarioProfile;
  onScenarioChange: (scenarioId: ScenarioId) => void;
}

export default function ScenarioSwitcher({ scenario, onScenarioChange }: ScenarioSwitcherProps) {
  return (
    <div className="border-t border-[#3A3A4E] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-[#8888AA]">当前场景</span>
        <select
          value={scenario.id}
          onChange={(event) => onScenarioChange(event.target.value as ScenarioId)}
          className="min-w-0 flex-1 rounded-md border border-[#3A3A4E] bg-[#2A2A3E] px-3 py-2 text-sm text-[#EAEAEA] outline-none transition-colors focus:border-[#00E0FF]"
          aria-label="切换场景"
        >
          {SCENARIOS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#8888AA]">
        {scenario.description}
      </p>
    </div>
  );
}
