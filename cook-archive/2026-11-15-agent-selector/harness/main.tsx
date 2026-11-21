import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPicker, type AgentSelection } from '@/components/ade/AgentPicker';
import '../../../src/styles.css';
import './stage.css';
const params = new URLSearchParams(location.search);
const agent = params.get('agent') || 'claude';
const defaults: Record<string, string> = { claude: 'Opus 5.5', codex: 'GPT-6.1 Terra', opencode: 'OpenCode/Big Pickle' };
function App() {
  const permissions: Record<string, AgentSelection['permission']> = { claude: 'auto', codex: 'approve', opencode: 'build' };
  const [selection, setSelection] = useState<AgentSelection>({ agentId: agent, model: defaults[agent] ?? '', effort: agent === 'opencode' ? '' : 'low', speed: '', permission: permissions[agent] ?? 'build' });
  return <main className={`stage stage-${agent}`}><div className="picker-wrap"><AgentPicker value={selection} onChange={setSelection} onClose={() => {}} /></div></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
