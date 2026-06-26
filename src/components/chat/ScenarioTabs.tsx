'use client';

import React from 'react';
import { SCENARIOS, type ScenarioId, type ScenarioProfile } from '@datasourceintelligence/shared';

interface ScenarioTabsProps {
  scenario: ScenarioProfile;
  onScenarioChange: (scenarioId: ScenarioId) => void;
}

export default function ScenarioTabs({ scenario, onScenarioChange }: ScenarioTabsProps) {
  return (
    <div className="flex items-center border-b border-[#3A3A4E] bg-[#1E1E2E] px-2">
      <div className="flex w-full gap-1 overflow-x-auto py-1">
        {SCENARIOS.map((item) => {
          const active = item.id === scenario.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onScenarioChange(item.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-[#00E0FF]/10 text-[#00E0FF]'
                  : 'text-[#8888AA] hover:bg-[#2A2A3E] hover:text-[#EAEAEA]'
              }`}
              aria-pressed={active}
            >
              {item.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
